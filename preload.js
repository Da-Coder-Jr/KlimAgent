/**
 * KlimAgent — Preload (contextBridge)
 * Exposes only klimAPI to the renderer. No Node.js internals leak through.
 */
const { contextBridge } = require('electron');

const API = 'http://localhost:3001';
let _abort = null;

contextBridge.exposeInMainWorld('klimAPI', {

  // ── Text Chat ──────────────────────────────────────────────────────────────
  sendMessage: async (params) => {
    if (_abort) _abort.abort();
    _abort = new AbortController();
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: _abort.signal,
    });
    return res.body.getReader();
  },

  stopQuery: async (chatId) => {
    if (_abort) { _abort.abort(); _abort = null; }
    try {
      await fetch(`${API}/api/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
    } catch {}
  },

  abortCurrentRequest: () => {
    if (_abort) { _abort.abort(); _abort = null; }
  },

  getModels: async () => {
    try { return await (await fetch(`${API}/api/models`)).json(); }
    catch { return [{ id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', vision: false }]; }
  },

  clearHistory: async (chatId) => {
    try {
      await fetch(`${API}/api/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
    } catch {}
  },

  healthCheck: async () => {
    try { return await (await fetch(`${API}/api/health`)).json(); }
    catch { return { status: 'offline' }; }
  },

  // ── GUI Agent ──────────────────────────────────────────────────────────────
  runGuiAgent: async (params) => {
    const res = await fetch(`${API}/api/bridge/gui-agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.body.getReader();
  },

  stopGuiAgent: async (sessionId) => {
    try {
      await fetch(`${API}/api/bridge/gui-agent/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch {}
  },

  takeScreenshot: async () => {
    try {
      return await (await fetch(`${API}/api/bridge/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })).json();
    } catch { return null; }
  },

  bridgeHealth: async () => {
    try { return await (await fetch(`${API}/api/bridge/health`)).json(); }
    catch { return { status: 'offline' }; }
  },
});
