import { createConfigurationController } from './dashboard-configuration.js';

export function homeAssistantOrigin(value) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function status(data) {
  const value = data?.homeAssistant;
  if (!value || ['configured', 'accessTokenPresent', 'encryptionReady', 'needsReauthentication'].some((key) => typeof value[key] !== 'boolean') || (value.accessTokenPresent && !homeAssistantOrigin(value.baseUrl ?? ''))) throw new Error('Invalid Home Assistant status.');
  return { configured: value.configured, accessTokenPresent: value.accessTokenPresent, encryptionReady: value.encryptionReady, needsReauthentication: value.needsReauthentication, baseUrl: value.baseUrl ?? '', updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '' };
}

export function createHomeAssistantController(options = {}) {
  const initial = { configured: false, accessTokenPresent: false, encryptionReady: false, needsReauthentication: false, baseUrl: '', updatedAt: '' };
  const controller = createConfigurationController({ ...options, url: '/api/home-assistant', initial, decode: status });
  return { ...controller,
    connect: (input) => controller.mutate('/api/home-assistant', 'PUT', { url: input.url, accessToken: input.accessToken }, status),
    disconnect: () => controller.mutate('/api/home-assistant', 'DELETE', undefined, (_data, previous) => ({ ...initial, encryptionReady: previous.encryptionReady }))
  };
}
