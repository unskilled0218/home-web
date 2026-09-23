import { createHash } from 'node:crypto';

const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_REGISTRY_ENTRIES = 5_000;
const TRUST_ERROR_CODES = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_UNTRUSTED']);
const CONNECTION_FAILED = 'Home Assistant connection failed. Check the URL and network; for a private certificate, configure NODE_EXTRA_CA_CERTS and restart the dashboard.';

class HomeAssistantClientError extends Error {}

const clientError = (message) => new HomeAssistantClientError(message);

export function isHomeAssistantClientError(error) {
  return error instanceof HomeAssistantClientError;
}

export function homeAssistantWebSocketError(event) {
  const candidates = [event?.error, event?.error?.cause, event, event?.cause];
  const code = candidates.map((candidate) => candidate?.code).find((value) => typeof value === 'string');
  if (TRUST_ERROR_CODES.has(code)) return clientError('Home Assistant certificate is not trusted. Configure NODE_EXTRA_CA_CERTS with its private CA bundle and restart the dashboard.');
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return clientError('Home Assistant certificate does not match the configured hostname. Fix the Home Assistant URL or certificate subject alternative names.');
  if (code === 'CERT_HAS_EXPIRED' || code === 'CERT_NOT_YET_VALID') return clientError('Home Assistant certificate is expired or not yet valid. Replace the certificate or correct the system clock.');
  return clientError(CONNECTION_FAILED);
}

export function normalizeHomeAssistantCredentials(input, existing = null) {
  let url;
  try { url = new URL(typeof input.url === 'string' ? input.url.trim() : ''); }
  catch { throw new Error('Home Assistant URL must be an absolute http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Home Assistant URL must be an origin without credentials, a path, query, or fragment.');
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  if (!accessToken && !existing) throw new Error('A long-lived access token is required to connect Home Assistant.');
  if (accessToken.length > 4_096) throw new Error('Home Assistant access token is too long.');
  return { baseUrl: url.origin, accessToken: accessToken || null };
}

function safeText(value, limit) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
}

export function normalizeHomeAssistantDevices(devices, areas, maxEntries = MAX_REGISTRY_ENTRIES) {
  if (!Array.isArray(devices) || !Array.isArray(areas)) throw new Error('Home Assistant returned an invalid device registry.');
  if (devices.length > maxEntries || areas.length > maxEntries) throw new Error('Home Assistant returned too many registry entries.');
  const areaNames = new Map();
  for (const area of areas) {
    const id = safeText(area?.area_id, 128);
    const name = safeText(area?.name, 160);
    if (id && name && !areaNames.has(id)) areaNames.set(id, name);
  }
  const seen = new Set();
  const normalized = [];
  for (const device of devices) {
    const id = safeText(device?.id, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const manufacturer = safeText(device?.manufacturer, 160);
    const model = safeText(device?.model, 160);
    const name = safeText(device?.name_by_user, 160) ?? safeText(device?.name, 160) ?? model ?? 'Unnamed device';
    const area = areaNames.get(safeText(device?.area_id, 128)) ?? null;
    normalized.push({ id, name, area, ...(manufacturer && { manufacturer }), ...(model && { model }), disabled: Boolean(device?.disabled_by) });
  }
  const compare = (left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' });
  normalized.sort((left, right) => compare(left.area ?? 'Unassigned', right.area ?? 'Unassigned') || compare(left.name, right.name) || compare(left.id, right.id));
  return normalized.map(({ id: _id, ...device }) => device);
}

function webSocketUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/websocket';
  return url.href;
}

function registrySnapshot(settings, { webSocketFactory, timeoutMs, maxMessageBytes, maxEntries }) {
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    let phase = 'awaiting_auth_required';
    const pendingCommands = new Set();
    let devices;
    let areas;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.removeEventListener?.('message', onMessage);
      socket?.removeEventListener?.('error', onError);
      socket?.removeEventListener?.('close', onClose);
      try { socket?.close(); } catch { /* Cleanup must not replace the request result. */ }
      if (error) reject(error);
      else resolve(result);
    };
    const send = (message) => {
      if (settled) return;
      try { socket.send(JSON.stringify(message)); }
      catch { finish(clientError(CONNECTION_FAILED)); }
    };
    const onMessage = (event) => {
      if (settled || typeof event.data !== 'string' || Buffer.byteLength(event.data) > maxMessageBytes) return finish(clientError('Home Assistant returned an invalid response.'));
      let message;
      try { message = JSON.parse(event.data); }
      catch { return finish(clientError('Home Assistant returned an invalid response.')); }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return finish(clientError('Home Assistant returned an invalid response.'));
      if (phase !== 'commands') {
        if (phase === 'awaiting_auth_required' && message.type === 'auth_required') {
          phase = 'awaiting_auth_result';
          send({ type: 'auth', access_token: settings.accessToken });
          return;
        }
        if (phase === 'awaiting_auth_result' && message.type === 'auth_invalid') return finish(clientError('Home Assistant rejected the access token.'));
        if (phase === 'awaiting_auth_result' && message.type === 'auth_ok') {
          phase = 'commands';
          pendingCommands.add(1); pendingCommands.add(2);
          send({ id: 1, type: 'config/device_registry/list' });
          send({ id: 2, type: 'config/area_registry/list' });
          return;
        }
        return finish(clientError('Home Assistant returned an unexpected authentication response.'));
      }
      if (message.type !== 'result' || !pendingCommands.has(message.id) || typeof message.success !== 'boolean') return finish(clientError('Home Assistant returned an invalid command response.'));
      pendingCommands.delete(message.id);
      if (!message.success) return finish(clientError('Home Assistant could not list its device registry.'));
      if (!Array.isArray(message.result)) return finish(clientError('Home Assistant returned an invalid device registry.'));
      if (message.id === 1) devices = message.result;
      else areas = message.result;
      if (pendingCommands.size === 0) {
        try { finish(null, normalizeHomeAssistantDevices(devices, areas, maxEntries)); }
        catch (error) { finish(clientError(error.message)); }
      }
    };
    const onError = (event) => finish(homeAssistantWebSocketError(event));
    const onClose = () => finish(clientError('Home Assistant closed the connection before completing the request.'));
    const timer = setTimeout(() => finish(clientError('Home Assistant connection timed out.')), timeoutMs);
    try {
      socket = webSocketFactory(webSocketUrl(settings.baseUrl));
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    } catch { finish(clientError(CONNECTION_FAILED)); }
  });
}

export function createHomeAssistantClient({ webSocketFactory = (url) => new WebSocket(url), timeoutMs = 8_000, cacheSeconds = 30, maxMessageBytes = MAX_MESSAGE_BYTES, maxEntries = MAX_REGISTRY_ENTRIES, now = Date.now } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let cacheGeneration = 0;
  const keyFor = (settings) => createHash('sha256').update(`${settings.baseUrl}\0${settings.accessToken}`).digest('base64url');
  return {
    clearCache() { cacheGeneration += 1; cache.clear(); inFlight.clear(); },
    async listDevices(settings, { force = false } = {}) {
      const key = keyFor(settings);
      const cached = cache.get(key);
      if (!force && cached && now() - cached.fetchedAt < cacheSeconds * 1_000) return cached.devices;
      const existing = inFlight.get(key);
      if (existing) return existing;
      const generation = cacheGeneration;
      const request = registrySnapshot(settings, { webSocketFactory, timeoutMs, maxMessageBytes, maxEntries });
      inFlight.set(key, request);
      try {
        const devices = await request;
        if (generation === cacheGeneration) cache.set(key, { devices, fetchedAt: now() });
        return devices;
      } finally { if (inFlight.get(key) === request) inFlight.delete(key); }
    }
  };
}
