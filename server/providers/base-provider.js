/**
 * KlimAgent - Base Provider
 * Abstract base class for all AI providers
 */

export class BaseProvider {
  constructor(config = {}) {
    this.config = config;
    this._sessions = new Map();
    this._abortControllers = new Map();
  }

  get name() {
    throw new Error('Provider must implement name getter');
  }

  async initialize() {
    // Override in subclasses if needed
  }

  async *query(params) {
    throw new Error('Provider must implement query() generator');
  }

  getSession(chatId) {
    return this._sessions.get(chatId);
  }

  setSession(chatId, session) {
    this._sessions.set(chatId, session);
  }

  abort(chatId) {
    const controller = this._abortControllers.get(chatId);
    if (controller) {
      controller.abort();
      this._abortControllers.delete(chatId);
    }
  }

  createAbortController(chatId) {
    const controller = new AbortController();
    this._abortControllers.set(chatId, controller);
    return controller;
  }

  async cleanup() {
    for (const controller of this._abortControllers.values()) {
      controller.abort();
    }
    this._abortControllers.clear();
    this._sessions.clear();
  }
}
