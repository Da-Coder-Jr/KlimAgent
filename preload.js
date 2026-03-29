/**
 * KlimAgent — Preload Script
 */
const { contextBridge } = require('electron');

const SERVER_URL = 'http://localhost:3001';
let currentAbortController = null;

contextBridge.exposeInMainWorld('klimAPI', {
  // ── Text Chat ──────────────────────────────────────────────────────────────
  sendMessage: async (params) => {
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();
    const res = await fetch(`${SERVER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: currentAbortController.signal
    });
    return res.body.getReader();
  },
  stopQuery: async (chatId, provider) => {
    if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
    try {
      await fetch(`${SERVER_URL}/api/abort`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, provider })
      });
    } catch {}
  },
  abortCurrentRequest: () => {
    if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
  },
  getProviders: async () => {
    try { return await (await fetch(`${SERVER_URL}/api/providers`)).json(); } catch { return ['nvidia-nim']; }
  },
  getModels: async () => {
    try { return await (await fetch(`${SERVER_URL}/api/models`)).json(); }
    catch { return [{ id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'Meta', vision: false }]; }
  },
  clearHistory: async (chatId, provider) => {
    try {
      await fetch(`${SERVER_URL}/api/clear`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, provider })
      });
    } catch {}
  },
  healthCheck: async () => {
    try { return await (await fetch(`${SERVER_URL}/api/health`)).json(); } catch { return { status: 'offline' }; }
  },

  // ── GUI Agent ──────────────────────────────────────────────────────────────
  runGuiAgent: async (params) => {
    const res = await fetch(`${SERVER_URL}/api/bridge/gui-agent/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.body.getReader();
  },
  stopGuiAgent: async (sessionId) => {
    try {
      await fetch(`${SERVER_URL}/api/bridge/gui-agent/stop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
    } catch {}
  },
  takeScreenshot: async (sessionId) => {
    try { return await (await fetch(`${SERVER_URL}/api/bridge/screenshot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    })).json(); } catch { return null; }
  },
  bridgeHealth: async () => {
    try { return await (await fetch(`${SERVER_URL}/api/bridge/health`)).json(); } catch { return { status: 'offline' }; }
  },

  // ── OSWorld Benchmark ──────────────────────────────────────────────────────
  runBenchmark: async (params) => {
    const res = await fetch(`${SERVER_URL}/api/bridge/benchmark/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.body.getReader();
  },
});
