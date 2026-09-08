import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { createStore } from './db.js';
import { normalizeBroadcastAddress, normalizeMacAddress, isValidIpv4, sendMagicPacket } from './wol.js';
import { decryptApiKey, encryptApiKey, encryptionKey } from './linkwarden-crypto.js';
import { createLinkwardenClient, normalizeLinkwardenCredentials } from './linkwarden.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const store = createStore(config.databasePath);
const wakeRequests = new Map();
const linkwarden = createLinkwardenClient({ cacheSeconds: config.linkwardenCacheSeconds });
const collectionSelections = new Map();
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function isTrustedAddress(address = '') {
  const normalized = address.replace(/^::ffff:/, '');
  if (normalized === '::1' || normalized === '127.0.0.1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (!isValidIpv4(normalized)) return false;
  const [first, second] = normalized.split('.').map(Number);
  return first === 10 || first === 127 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers.host;
  return origin === `http://${host}` || origin === `https://${host}`;
}

function validateDevice(input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const group = typeof input.group === 'string' ? input.group.trim() : '';
  const ipAddress = typeof input.ipAddress === 'string' && input.ipAddress.trim() ? input.ipAddress.trim() : null;
  if (!name || name.length > 80) throw new Error('Name is required and must be at most 80 characters.');
  if (group.length > 80) throw new Error('Group must be at most 80 characters.');
  if (ipAddress && !isValidIpv4(ipAddress)) throw new Error('IP address must be a valid IPv4 address when provided.');
  return { name, group, ipAddress, macAddress: normalizeMacAddress(input.macAddress), broadcastAddress: normalizeBroadcastAddress(input.broadcastAddress) };
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error('Request body is too large.');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Request body must be valid JSON.'); }
}

function deviceId(pathname, suffix = '') {
  const match = new RegExp(`^/api/devices/(\\d+)${suffix}$`).exec(pathname);
  return match ? Number(match[1]) : null;
}

function linkwardenStatus() {
  const saved = store.getLinkwarden();
  let encryptionReady = false;
  try { encryptionKey(config.linkwardenEncryptionKey); encryptionReady = true; } catch { /* The optional integration remains disabled until a valid key is supplied. */ }
  const needsReauthentication = Boolean(saved && (!saved.username || !saved.collectionName));
  return { configured: Boolean(saved) && !needsReauthentication, accessTokenPresent: Boolean(saved), encryptionReady, needsReauthentication, ...(saved && !needsReauthentication && { baseUrl: saved.baseUrl, username: saved.username, collectionName: saved.collectionName, updatedAt: saved.updatedAt }) };
}

function savedLinkwardenSettings() {
  const saved = store.getLinkwarden();
  if (!saved) throw new Error('Linkwarden is not configured.');
  if (!saved.username || !saved.collectionName) throw new Error('Linkwarden needs re-authentication before bookmarks can be loaded.');
  try { return { baseUrl: saved.baseUrl, username: saved.username, collectionName: saved.collectionName, collectionId: saved.collectionId, accessToken: decryptApiKey(saved.encryptedAccessToken, config.linkwardenEncryptionKey) }; } catch { throw new Error('Linkwarden credentials cannot be decrypted. Check the encryption secret.'); }
}

function selectionFingerprint(settings) {
  return createHash('sha256').update(`${settings.baseUrl}\0${settings.username}\0${settings.accessToken}`).digest('base64url');
}

function storeCollectionSelections(settings, collections) {
  const now = Date.now();
  for (const [token, selection] of collectionSelections) if (selection.expiresAt <= now) collectionSelections.delete(token);
  if (collectionSelections.size > 1_000) collectionSelections.clear();
  return collections.map((collection) => {
    const token = randomBytes(24).toString('base64url');
    collectionSelections.set(token, { ...collection, baseUrl: settings.baseUrl, username: settings.username, fingerprint: selectionFingerprint(settings), expiresAt: now + 5 * 60_000 });
    return { name: collection.name, selectionToken: token };
  });
}

function selectedCollection(input, settings) {
  const token = typeof input.collectionToken === 'string' ? input.collectionToken : '';
  const selection = collectionSelections.get(token);
  if (!selection || selection.expiresAt <= Date.now() || selection.baseUrl !== settings.baseUrl || selection.username !== settings.username || selection.fingerprint !== selectionFingerprint(settings)) throw new Error('Select a collection from the current Linkwarden list.');
  return selection;
}

function credentialsFromInput(input) {
  const existing = store.getLinkwarden();
  const settings = normalizeLinkwardenCredentials(input, existing);
  if (!settings.accessToken && existing) settings.accessToken = decryptApiKey(existing.encryptedAccessToken, config.linkwardenEncryptionKey);
  return settings;
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(publicRoot, `.${requested}`);
  if (!target.startsWith(`${publicRoot}${path.sep}`)) return json(response, 404, { error: 'Not found.' });
  try {
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(target)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    response.end(content);
  } catch { json(response, 404, { error: 'Not found.' }); }
}

async function handleApi(request, response, pathname) {
  if (!isTrustedAddress(request.socket.remoteAddress)) return json(response, 403, { error: 'This service only accepts local-network requests.' });
  if (request.method !== 'GET' && !sameOrigin(request)) return json(response, 403, { error: 'Request origin is not allowed.' });
  if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok' });
  if (request.method === 'GET' && pathname === '/api/devices') return json(response, 200, { devices: store.list() });
  if (request.method === 'GET' && pathname === '/api/linkwarden') return json(response, 200, { linkwarden: linkwardenStatus() });
  if (request.method === 'GET' && pathname === '/api/bookmarks') {
    if (!store.getLinkwarden()) return json(response, 200, { configured: false, bookmarks: [] });
    try {
      const result = await linkwarden.getBookmarks(savedLinkwardenSettings(), { force: new URL(request.url, 'http://localhost').searchParams.get('refresh') === '1' });
      return json(response, 200, { configured: true, ...result });
    } catch { return json(response, 503, { configured: true, error: 'Bookmarks are currently unavailable.' }); }
  }

  const id = deviceId(pathname);
  const wakeId = deviceId(pathname, '/wake');
  try {
    if (request.method === 'POST' && pathname === '/api/devices') return json(response, 201, { device: store.create(validateDevice(await readJson(request))) });
    if (request.method === 'POST' && pathname === '/api/linkwarden/collections') {
      const settings = credentialsFromInput(await readJson(request));
      const collections = await linkwarden.listCollections(settings);
      return json(response, 200, { collections: storeCollectionSelections(settings, collections) });
    }
    if (request.method === 'POST' && pathname === '/api/linkwarden/test') {
      const input = await readJson(request);
      const settings = credentialsFromInput(input);
      const collection = selectedCollection(input, settings);
      await linkwarden.test({ ...settings, collectionId: collection.id });
      return json(response, 200, { message: 'Linkwarden connection succeeded.' });
    }
    if (request.method === 'PUT' && pathname === '/api/linkwarden') {
      const input = await readJson(request);
      const settings = credentialsFromInput(input);
      const collection = selectedCollection(input, settings);
      store.saveLinkwarden({ ...settings, collectionName: collection.name, collectionId: collection.id, encryptedAccessToken: encryptApiKey(settings.accessToken, config.linkwardenEncryptionKey) });
      linkwarden.clearCache();
      return json(response, 200, { linkwarden: linkwardenStatus() });
    }
    if (request.method === 'DELETE' && pathname === '/api/linkwarden') {
      store.removeLinkwarden(); linkwarden.clearCache(); return json(response, 204, {});
    }
    if (request.method === 'PUT' && id) {
      if (!store.get(id)) return json(response, 404, { error: 'Device not found.' });
      return json(response, 200, { device: store.update(id, validateDevice(await readJson(request))) });
    }
    if (request.method === 'DELETE' && id) return store.remove(id) ? json(response, 204, {}) : json(response, 404, { error: 'Device not found.' });
    if (request.method === 'POST' && wakeId) {
      const device = store.get(wakeId);
      if (!device) return json(response, 404, { error: 'Device not found.' });
      const now = Date.now();
      const last = wakeRequests.get(wakeId) ?? 0;
      const waitMs = config.wakeCooldownSeconds * 1_000 - (now - last);
      if (waitMs > 0) return json(response, 429, { error: `Please wait ${Math.ceil(waitMs / 1_000)} seconds before waking this device again.` });
      wakeRequests.set(wakeId, now);
      try {
        const dispatch = await sendMagicPacket({ macAddress: device.macAddress, broadcastAddress: device.broadcastAddress, ipAddress: device.ipAddress, port: config.wolPort });
        store.markWake(wakeId);
        store.audit(wakeId, 'sent', `${dispatch.sent}/${dispatch.attempted} Moonlight-compatible UDP datagrams sent`);
        return json(response, 200, { message: `Wake packet sent to ${device.name} (${dispatch.sent}/${dispatch.attempted} Moonlight-compatible UDP datagrams). This does not confirm that it has powered on.` });
      } catch (error) {
        store.audit(wakeId, 'failed', String(error.message).slice(0, 240));
        return json(response, 502, { error: 'Unable to send the wake packet. Check the host network and device broadcast address.' });
      }
    }
  } catch (error) {
    if (error?.code?.startsWith('ERR_SQLITE_CONSTRAINT')) return json(response, 409, { error: 'A device already uses that MAC address.' });
    return json(response, 400, { error: error.message || 'Invalid request.' });
  }
  return json(response, 404, { error: 'Not found.' });
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).pathname;
  if (pathname.startsWith('/api/')) return handleApi(request, response, pathname);
  return serveStatic(request, response, pathname);
});

server.listen(config.port, config.host, () => console.log(`LAN WoL dashboard listening at http://${config.host}:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
