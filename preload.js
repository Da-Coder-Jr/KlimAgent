/**
 * KlimAgent - Preload Script
 * Exposes secure IPC bridge to the renderer process.
 */

const { contextBridge } = require('electron');

const SERVER_URL = 'http://localhost:3001';

let currentAbortController = null;

contextBridge.exposeInMainWorld('klimAPI', {
  /**
   * Send a message and stream the response.
   * @returns {ReadableStreamDefaultReader}
   */
  sendMessage: async (params) => {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    const response = await fetch(`${SERVER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: currentAbortController.signal
    });

    return response.body.getReader();
  },

  /**
   * Abort the current in-flight request.
   */
  stopQuery: async (chatId, provider) => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    try {
      await fetch(`${SERVER_URL}/api/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, provider })
      });
    } catch {}
  },

  /**
   * Client-side abort only.
   */
  abortCurrentRequest: () => {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  },

  /**
   * Get available providers.
   */
  getProviders: async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/providers`);
      return await res.json();
    } catch {
      return ['nvidia-nim'];
    }
  },

  /**
   * Get available NVIDIA NIM models.
   */
  getModels: async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/models`);
      return await res.json();
    } catch {
      return [{ id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'Meta' }];
    }
  },

  /**
   * Clear conversation history for a chat.
   */
  clearHistory: async (chatId, provider) => {
    try {
      await fetch(`${SERVER_URL}/api/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, provider })
      });
    } catch {}
  },

  /**
   * Check server health.
   */
  healthCheck: async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      return await res.json();
    } catch {
      return { status: 'offline' };
    }
  }
});
