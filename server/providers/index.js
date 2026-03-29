/**
 * KlimAgent - Provider Registry
 * All providers use NVIDIA NIM as the inference backend.
 */

import { NvidiaNimProvider } from './nvidia-nim-provider.js';

const providerCache = new Map();
const providerRegistry = new Map([
  ['nvidia-nim', NvidiaNimProvider],
  ['default', NvidiaNimProvider]
]);

export function getProvider(name = 'nvidia-nim', config = {}) {
  const key = name || 'nvidia-nim';
  if (providerCache.has(key)) {
    return providerCache.get(key);
  }
  const ProviderClass = providerRegistry.get(key) || NvidiaNimProvider;
  const instance = new ProviderClass(config);
  providerCache.set(key, instance);
  return instance;
}

export function getAvailableProviders() {
  return [...providerRegistry.keys()].filter(k => k !== 'default');
}

export function registerProvider(name, ProviderClass) {
  providerRegistry.set(name, ProviderClass);
}

export function clearProviderCache() {
  for (const provider of providerCache.values()) {
    provider.cleanup?.();
  }
  providerCache.clear();
}

export async function initializeProviders() {
  try {
    const defaultProvider = getProvider('nvidia-nim');
    await defaultProvider.initialize();
    console.log('[KlimAgent] Providers initialized successfully');
  } catch (err) {
    console.warn('[KlimAgent] Provider initialization warning:', err.message);
  }
}
