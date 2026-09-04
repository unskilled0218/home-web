import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createStore } from './db.js';
import { normalizeBroadcastAddress, normalizeMacAddress, isValidIpv4, sendMagicPacket } from './wol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const store = createStore(config.databasePath);
const wakeRequests = new Map();
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

  const id = deviceId(pathname);
  const wakeId = deviceId(pathname, '/wake');
  try {
    if (request.method === 'POST' && pathname === '/api/devices') return json(response, 201, { device: store.create(validateDevice(await readJson(request))) });
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
        await sendMagicPacket({ macAddress: device.macAddress, broadcastAddress: device.broadcastAddress, port: config.wolPort });
        store.markWake(wakeId);
        store.audit(wakeId, 'sent');
        return json(response, 200, { message: `Wake packet sent to ${device.name}. This does not confirm that it has powered on.` });
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
