/**
 * KlimAgent - Express Server
 * Streams responses from NVIDIA NIM via Server-Sent Events (SSE).
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getProvider, getAvailableProviders, initializeProviders } from './providers/index.js';

dotenv.config({ path: '../.env' });
dotenv.config(); // also try local .env

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Active query registry for abort support
const activeQueries = new Map();

// ─── Health ────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'KlimAgent',
    version: '1.0.0',
    provider: 'nvidia-nim',
    model: process.env.NVIDIA_NIM_MODEL || 'meta/llama-3.3-70b-instruct',
    timestamp: new Date().toISOString()
  });
});

// ─── Providers ─────────────────────────────────────────────────────────────

app.get('/api/providers', (req, res) => {
  res.json(getAvailableProviders());
});

app.get('/api/models', (req, res) => {
  // Curated list of NVIDIA NIM models
  res.json([
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', provider: 'Meta' },
    { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B Instruct', provider: 'Meta' },
    { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', provider: 'Meta' },
    { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B Instruct', provider: 'Mistral AI' },
    { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral AI' },
    { id: 'mistralai/mistral-7b-instruct-v0.3', name: 'Mistral 7B Instruct', provider: 'Mistral AI' },
    { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B IT', provider: 'Google' },
    { id: 'google/gemma-2-9b-it', name: 'Gemma 2 9B IT', provider: 'Google' },
    { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct', provider: 'Alibaba' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B Instruct', provider: 'NVIDIA' },
    { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', name: 'Nemotron Ultra 253B', provider: 'NVIDIA' }
  ]);
});

// ─── Chat (SSE streaming) ──────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { message, chatId, provider: providerName, model, systemPrompt } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const id = chatId || `chat_${Date.now()}`;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 15000);

  // Track for abort
  activeQueries.set(id, { res, heartbeat });

  try {
    const provider = getProvider(providerName || 'nvidia-nim', {
      model: model || process.env.NVIDIA_NIM_MODEL
    });

    const stream = provider.query({ message, chatId: id, model, systemPrompt });

    for await (const event of stream) {
      if (!activeQueries.has(id)) break; // aborted

      switch (event.type) {
        case 'text':
          sendEvent({ type: 'text', text: event.text });
          break;
        case 'tool_use':
          sendEvent({
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input
          });
          break;
        case 'tool_result':
          sendEvent({
            type: 'tool_result',
            tool_use_id: event.tool_use_id,
            content: event.content
          });
          break;
        case 'error':
          sendEvent({ type: 'error', error: event.error });
          break;
        default:
          sendEvent(event);
      }
    }

    sendEvent({ type: 'done' });
  } catch (err) {
    console.error('[KlimAgent] Chat error:', err.message);
    sendEvent({ type: 'error', error: err.message });
  } finally {
    clearInterval(heartbeat);
    activeQueries.delete(id);
    res.end();
  }
});

// ─── Abort ─────────────────────────────────────────────────────────────────

app.post('/api/abort', (req, res) => {
  const { chatId, provider: providerName } = req.body;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId is required' });
  }

  // Cancel the SSE stream
  const query = activeQueries.get(chatId);
  if (query) {
    clearInterval(query.heartbeat);
    try { query.res.end(); } catch {}
    activeQueries.delete(chatId);
  }

  // Signal the provider to abort
  try {
    const provider = getProvider(providerName || 'nvidia-nim');
    provider.abort(chatId);
  } catch {}

  res.json({ success: true, chatId });
});

// ─── Clear history ─────────────────────────────────────────────────────────

app.post('/api/clear', (req, res) => {
  const { chatId, provider: providerName } = req.body;
  try {
    const provider = getProvider(providerName || 'nvidia-nim');
    if (typeof provider.clearHistory === 'function') {
      provider.clearHistory(chatId || 'default');
    }
  } catch {}
  res.json({ success: true });
});

// ─── Start ─────────────────────────────────────────────────────────────────

async function start() {
  await initializeProviders().catch(err => {
    console.warn('[KlimAgent] Startup warning:', err.message);
  });

  app.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════╗`);
    console.log(`║     KlimAgent Server v1.0.0        ║`);
    console.log(`║  Powered by NVIDIA NIM              ║`);
    console.log(`╚════════════════════════════════════╝`);
    console.log(`\n  Server: http://localhost:${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/api/health\n`);
  });
}

start();
