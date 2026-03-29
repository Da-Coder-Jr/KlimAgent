/**
 * KlimAgent — Express Server (port 3001)
 * Text chat via NVIDIA NIM + proxy to Python Agent-S bridge (port 3002).
 */
import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
import http    from 'http';
import { getProvider, getAvailableProviders, initializeProviders } from './providers/index.js';

dotenv.config({ path: '../.env' });
dotenv.config();

const app         = express();
const PORT        = parseInt(process.env.PORT        || '3001');
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '3002');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const activeQueries = new Map();

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:  'ok',
    name:    'KlimAgent',
    version: '1.0.0',
    provider: 'nvidia-nim',
    model:   process.env.NVIDIA_NIM_MODEL || 'meta/llama-3.3-70b-instruct',
    bridge:  `http://localhost:${BRIDGE_PORT}`,
  });
});

// ── Models ────────────────────────────────────────────────────────────────────
app.get('/api/models', (_req, res) => {
  res.json([
    // Text models
    { id: 'meta/llama-3.3-70b-instruct',              name: 'Llama 3.3 70B',        provider: 'Meta',       vision: false },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct',   name: 'Nemotron 70B',         provider: 'NVIDIA',     vision: false },
    { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',  name: 'Nemotron Ultra 253B',  provider: 'NVIDIA',     vision: false },
    { id: 'meta/llama-3.1-405b-instruct',             name: 'Llama 3.1 405B',       provider: 'Meta',       vision: false },
    { id: 'mistralai/mixtral-8x22b-instruct-v0.1',    name: 'Mixtral 8x22B',        provider: 'Mistral AI', vision: false },
    { id: 'mistralai/mistral-large',                  name: 'Mistral Large',        provider: 'Mistral AI', vision: false },
    { id: 'qwen/qwen2.5-72b-instruct',                name: 'Qwen 2.5 72B',         provider: 'Alibaba',    vision: false },
    // Vision models (for GUI agent)
    { id: 'nvidia/llama-3.2-90b-vision-instruct',     name: 'Llama 3.2 90B Vision', provider: 'NVIDIA',     vision: true  },
    { id: 'nvidia/llama-3.2-11b-vision-instruct',     name: 'Llama 3.2 11B Vision', provider: 'NVIDIA',     vision: true  },
    { id: 'microsoft/phi-3.5-vision-instruct',        name: 'Phi 3.5 Vision',       provider: 'Microsoft',  vision: true  },
  ]);
});

app.get('/api/providers', (_req, res) => res.json(getAvailableProviders()));

// ── Text Chat (SSE) ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, chatId, model, systemPrompt } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const id = chatId || `chat_${Date.now()}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send      = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 15000);
  activeQueries.set(id, { res, heartbeat });

  try {
    const provider = getProvider('nvidia-nim', { model });
    for await (const event of provider.query({ message, chatId: id, model, systemPrompt })) {
      if (!activeQueries.has(id)) break;
      send(event);
    }
    send({ type: 'done' });
  } catch (err) {
    console.error('[KlimAgent] chat error:', err.message);
    send({ type: 'error', error: err.message });
  } finally {
    clearInterval(heartbeat);
    activeQueries.delete(id);
    res.end();
  }
});

app.post('/api/abort', (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: 'chatId is required' });
  const q = activeQueries.get(chatId);
  if (q) { clearInterval(q.heartbeat); try { q.res.end(); } catch {} activeQueries.delete(chatId); }
  try { getProvider('nvidia-nim').abort(chatId); } catch {}
  res.json({ success: true });
});

app.post('/api/clear', (req, res) => {
  const { chatId } = req.body;
  try {
    const p = getProvider('nvidia-nim');
    if (typeof p.clearHistory === 'function') p.clearHistory(chatId || 'default');
  } catch {}
  res.json({ success: true });
});

// ── Bridge Proxy (streaming-safe) ─────────────────────────────────────────────
function proxyBridge(path, req, res) {
  const body = JSON.stringify(req.body || {});
  const opts = {
    hostname: 'localhost',
    port: BRIDGE_PORT,
    path,
    method: req.method,
    headers: {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Accept':         req.headers.accept || 'application/json',
    },
  };
  const pr = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    proxyRes.pipe(res);
  });
  pr.on('error', () => {
    if (!res.headersSent)
      res.status(503).json({ error: 'Python bridge offline. Run: python agent/bridge.py' });
  });
  pr.write(body);
  pr.end();
}

app.get('/api/bridge/health',        (req, res) => proxyBridge('/health',         req, res));
app.post('/api/bridge/screenshot',   (req, res) => proxyBridge('/screenshot',     req, res));
app.post('/api/bridge/gui-agent/run',(req, res) => proxyBridge('/gui-agent/run',  req, res));
app.post('/api/bridge/gui-agent/stop',(req,res) => proxyBridge('/gui-agent/stop', req, res));

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  await initializeProviders().catch(e => console.warn('[KlimAgent]', e.message));
  app.listen(PORT, () => {
    console.log(`\n╔═══════════════════════════════════════════╗`);
    console.log(`║         KlimAgent v1.0.0                  ║`);
    console.log(`║  Chat + GUI Agent  ·  NVIDIA NIM only     ║`);
    console.log(`╚═══════════════════════════════════════════╝`);
    console.log(`\n  Chat API : http://localhost:${PORT}`);
    console.log(`  Bridge   : http://localhost:${BRIDGE_PORT}  (python agent/bridge.py)`);
    console.log(`  Health   : http://localhost:${PORT}/api/health\n`);
  });
}

start();
