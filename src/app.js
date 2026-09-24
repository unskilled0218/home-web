import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { normalizeDashboardHostname } from './config.js';
import { normalizeBroadcastAddress, normalizeMacAddress, isValidIpv4 } from './wol.js';
import { executeWakeRequest } from './wake-request.js';
import { decryptApiKey, encryptApiKey, encryptionKey } from './linkwarden-crypto.js';
import { normalizeLinkwardenCredentials } from './linkwarden.js';
import { createCollectionSelectionStore } from './collection-selections.js';
import { isHomeAssistantClientError, normalizeHomeAssistantCredentials } from './home-assistant.js';
import { createHomeAssistantControlStore } from './home-assistant-controls.js';
import { isCalDavClientError, normalizeCalDavCredentials } from './caldav.js';

export const MAX_JSON_BODY_BYTES = 16_384;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPublicRoot = path.join(root, 'public');
const HOME_ASSISTANT_UNAVAILABLE = 'Home Assistant devices are currently unavailable.';
const CALENDAR_UNAVAILABLE = 'Calendar events are currently unavailable.';
const HOME_ASSISTANT_CONTROL_TTL_MS = 10 * 60_000;
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

function isTrustedAddress(address = '') {
  const normalized = address.replace(/^::ffff:/, '');
  if (normalized === '::1' || normalized === '127.0.0.1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (!isValidIpv4(normalized)) return false;
  const [first, second] = normalized.split('.').map(Number);
  return first === 10 || first === 127 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

function requestAuthority(request) {
  const rawHost = request.headers.host;
  if (typeof rawHost !== 'string' || !rawHost) return null;
  try {
    const parsed = new URL(`http://${rawHost}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return { hostname: normalizeDashboardHostname(parsed.hostname, 'Host'), port: parsed.port };
  } catch { return null; }
}

function apiRequestAllowed(request, allowedHosts) {
  const authority = requestAuthority(request);
  if (!authority || !allowedHosts.includes(authority.hostname)) return false;
  const origin = request.headers.origin;
  if (request.method === 'GET' || !origin) return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash && normalizeDashboardHostname(parsed.hostname, 'Origin') === authority.hostname && parsed.port === authority.port;
  } catch { return false; }
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

export async function readJson(request, limit = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks, total).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Request body must be valid JSON.'); }
}

function deviceId(pathname, suffix = '') {
  const match = new RegExp(`^/api/devices/(\\d+)${suffix}$`).exec(pathname);
  return match ? Number(match[1]) : null;
}

function homeAssistantControlToken(pathname) {
  const match = /^\/api\/home-assistant\/controls\/([A-Za-z0-9_-]{16,128})$/.exec(pathname);
  return match?.[1] ?? null;
}

function selectionFingerprint(settings) {
  return createHash('sha256').update(`${settings.baseUrl}\0${settings.username}\0${settings.accessToken}`).digest('base64url');
}

export function createDashboardServer({ runtimeConfig, store, linkwarden, homeAssistant, calDav, homeAssistantControls = createHomeAssistantControlStore(), wakeExecutor = executeWakeRequest, collectionSelections = createCollectionSelectionStore(), now = Date.now, publicRoot = defaultPublicRoot }) {
  const wakeRequests = new Map();
  const integrationEncryptionKey = runtimeConfig.integrationEncryptionKey ?? runtimeConfig.linkwardenEncryptionKey;
  let homeAssistantMutation = Promise.resolve();
  let calDavMutation = Promise.resolve();
  const homeAssistantActions = new Set();
  const queueHomeAssistantMutation = (operation) => {
    const result = homeAssistantMutation.then(operation, operation);
    homeAssistantMutation = result.catch(() => {});
    return result;
  };
  const queueCalDavMutation = (operation) => {
    const result = calDavMutation.then(operation, operation);
    calDavMutation = result.catch(() => {});
    return result;
  };

  function linkwardenStatus() {
    const saved = store.getLinkwarden();
    let encryptionReady = false;
    let credentialsReadable = false;
    try { encryptionKey(integrationEncryptionKey); encryptionReady = true; if (saved) { decryptApiKey(saved.encryptedAccessToken, integrationEncryptionKey); credentialsReadable = true; } } catch { /* The optional integration remains disabled until valid credentials can be decrypted. */ }
    const configured = Boolean(saved?.username && credentialsReadable);
    return { configured, accessTokenPresent: Boolean(saved), encryptionReady, needsReauthentication: Boolean(saved) && !configured, ...(configured && { baseUrl: saved.baseUrl, username: saved.username, updatedAt: saved.updatedAt }) };
  }

  function savedLinkwardenSettings() {
    const saved = store.getLinkwarden();
    if (!saved) throw new Error('Linkwarden is not configured.');
    if (!saved.username) throw new Error('Linkwarden needs re-authentication before bookmarks can be loaded.');
    try { return { baseUrl: saved.baseUrl, username: saved.username, accessToken: decryptApiKey(saved.encryptedAccessToken, integrationEncryptionKey) }; } catch { throw new Error('Linkwarden credentials cannot be decrypted. Check the encryption secret.'); }
  }

  function storeCollectionTree(settings, collections) {
    const fingerprint = selectionFingerprint(settings);
    const expiresAt = now() + 60 * 60_000;
    const tokenize = (collection) => ({
      name: collection.name,
      collectionToken: collectionSelections.issue({ id: collection.id, fingerprint, expiresAt }),
      children: collection.children.map(tokenize)
    });
    return collections.map(tokenize);
  }

  function selectedCollection(token, settings) {
    const selection = collectionSelections.resolve(token, selectionFingerprint(settings));
    if (!selection) throw new Error('Select a collection from the current Linkwarden tree.');
    return selection;
  }

  function credentialsFromInput(input) {
    const existing = store.getLinkwarden();
    const settings = normalizeLinkwardenCredentials(input, existing);
    if (!settings.accessToken && existing) {
      if (settings.baseUrl !== existing.baseUrl || settings.username !== existing.username) throw new Error('A new access token is required when changing the Linkwarden URL or username.');
      settings.accessToken = decryptApiKey(existing.encryptedAccessToken, integrationEncryptionKey);
    }
    return settings;
  }

  function homeAssistantStatus() {
    const saved = store.getHomeAssistant();
    let encryptionReady = false;
    let credentialsReadable = false;
    try { encryptionKey(integrationEncryptionKey); encryptionReady = true; if (saved) { decryptApiKey(saved.encryptedAccessToken, integrationEncryptionKey); credentialsReadable = true; } } catch { /* Re-authentication is required when saved credentials cannot be decrypted. */ }
    const configured = Boolean(saved && credentialsReadable);
    return { configured, accessTokenPresent: Boolean(saved), encryptionReady, needsReauthentication: Boolean(saved) && !configured, ...(saved && { baseUrl: saved.baseUrl, updatedAt: saved.updatedAt }) };
  }

  function savedHomeAssistantSettings() {
    const saved = store.getHomeAssistant();
    if (!saved) throw new Error('Home Assistant is not configured.');
    try { return { baseUrl: saved.baseUrl, accessToken: decryptApiKey(saved.encryptedAccessToken, integrationEncryptionKey) }; }
    catch { throw new Error('Home Assistant needs re-authentication.'); }
  }

  function homeAssistantFingerprint(settings) {
    return createHash('sha256').update(`${settings.baseUrl}\0${settings.accessToken}`).digest('base64url');
  }

  function publicHomeAssistantDevices(settings, devices) {
    const fingerprint = homeAssistantFingerprint(settings);
    const expiresAt = now() + HOME_ASSISTANT_CONTROL_TTL_MS;
    return devices.map(({ name, area, manufacturer, model, disabled, measurements = [], controls = [] }) => ({
      name,
      area,
      ...(manufacturer && { manufacturer }),
      ...(model && { model }),
      disabled: Boolean(disabled),
      measurements: measurements.map(({ name: readingName, value, unit, deviceClass, status, available }) => ({
        name: readingName,
        value,
        ...(unit && { unit }),
        ...(deviceClass && { deviceClass }),
        status,
        available: Boolean(available)
      })),
      controls: controls.map(({ entityId, domain, name, state }) => {
        const available = state === 'on' || state === 'off';
        const controlToken = homeAssistantControls.issue({ entityId, domain, available, fingerprint, expiresAt });
        return { controlToken, name, state, available };
      })
    }));
  }

  function homeAssistantCredentialsFromInput(input) {
    const existing = store.getHomeAssistant();
    const settings = normalizeHomeAssistantCredentials(input, existing);
    if (!settings.accessToken && existing) {
      if (settings.baseUrl !== existing.baseUrl) throw new Error('A new access token is required when changing the Home Assistant URL.');
      try { settings.accessToken = decryptApiKey(existing.encryptedAccessToken, integrationEncryptionKey); }
      catch { throw new Error('Home Assistant needs re-authentication.'); }
    }
    return settings;
  }

  function calDavStatus() {
    const saved = store.getCalDav();
    let encryptionReady = false;
    let credentialsReadable = false;
    try { encryptionKey(integrationEncryptionKey); encryptionReady = true; if (saved) { decryptApiKey(saved.encryptedPassword, integrationEncryptionKey); credentialsReadable = true; } } catch { /* Re-authentication is required when saved credentials cannot be decrypted. */ }
    const configured = Boolean(saved && credentialsReadable);
    return { configured, passwordPresent: Boolean(saved), encryptionReady, needsReauthentication: Boolean(saved) && !configured, ...(saved && { collectionUrl: saved.collectionUrl, username: saved.username, updatedAt: saved.updatedAt }) };
  }

  function savedCalDavSettings() {
    const saved = store.getCalDav();
    if (!saved) throw new Error('Calendar is not configured.');
    try { return { collectionUrl: saved.collectionUrl, username: saved.username, password: decryptApiKey(saved.encryptedPassword, integrationEncryptionKey) }; }
    catch { throw new Error('Calendar needs re-authentication.'); }
  }

  function calDavCredentialsFromInput(input) {
    const existing = store.getCalDav();
    const settings = normalizeCalDavCredentials(input, existing);
    if (!settings.password && existing) {
      if (settings.collectionUrl !== existing.collectionUrl || settings.username !== existing.username) throw new Error('A new CalDAV password is required when changing the collection URL or username.');
      try { settings.password = decryptApiKey(existing.encryptedPassword, integrationEncryptionKey); }
      catch { throw new Error('Calendar needs re-authentication.'); }
    }
    return settings;
  }

  function publicCalendarEvents(events) {
    if (!Array.isArray(events)) return [];
    return events.slice(0, 10).flatMap((event) => {
      if (!event || typeof event.title !== 'string' || typeof event.start !== 'string' || typeof event.end !== 'string' || typeof event.allDay !== 'boolean') return [];
      const title = event.title.trim().slice(0, 300) || 'Untitled event';
      const location = typeof event.location === 'string' ? event.location.trim().slice(0, 300) : '';
      return [{ title, start: event.start.slice(0, 40), end: event.end.slice(0, 40), allDay: event.allDay, ...(location && { location }) }];
    });
  }

  async function serveStatic(request, response, pathname) {
    const requested = pathname === '/' ? '/index.html' : ['/dashboard', '/dashboard/'].includes(pathname) ? '/dashboard.html' : pathname;
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
    if (!apiRequestAllowed(request, runtimeConfig.allowedHosts)) return json(response, 403, { error: 'Request host or origin is not allowed.' });
    if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok' });
    if (request.method === 'GET' && pathname === '/api/devices') return json(response, 200, { devices: store.list() });
    if (request.method === 'GET' && pathname === '/api/linkwarden') return json(response, 200, { linkwarden: linkwardenStatus() });
    if (request.method === 'GET' && pathname === '/api/home-assistant') return json(response, 200, { homeAssistant: homeAssistantStatus() });
    if (request.method === 'GET' && pathname === '/api/calendar') return json(response, 200, calDavStatus());
    if (request.method === 'GET' && pathname === '/api/calendar/events') {
      const status = calDavStatus();
      if (!status.configured) return json(response, 200, { configured: false, events: [], ...(status.needsReauthentication && { needsReauthentication: true }) });
      try {
        const url = new URL(request.url, 'http://localhost');
        const result = await calDav.listEvents(savedCalDavSettings(), { force: url.searchParams.get('refresh') === '1' });
        return json(response, 200, { configured: true, events: publicCalendarEvents(result.events), stale: result.stale === true });
      } catch (error) {
        if (isCalDavClientError(error) && error.kind === 'authentication') return json(response, 401, { configured: true, needsReauthentication: true, error: 'Calendar needs re-authentication.' });
        if (isCalDavClientError(error) && error.kind === 'authorization') return json(response, 403, { configured: true, accessDenied: true, error: error.message });
        return json(response, 503, { configured: true, error: CALENDAR_UNAVAILABLE });
      }
    }
    if (request.method === 'GET' && pathname === '/api/home-assistant/devices') {
      const status = homeAssistantStatus();
      if (!status.configured) return json(response, 200, { configured: false, devices: [], ...(status.needsReauthentication && { needsReauthentication: true }) });
      try {
        const url = new URL(request.url, 'http://localhost');
        const settings = savedHomeAssistantSettings();
        const devices = await homeAssistant.listDevices(settings, { force: url.searchParams.get('refresh') === '1' });
        return json(response, 200, { configured: true, devices: publicHomeAssistantDevices(settings, devices) });
      } catch (error) { return json(response, 503, { configured: true, error: isHomeAssistantClientError(error) ? error.message : HOME_ASSISTANT_UNAVAILABLE }); }
    }
    if (request.method === 'GET' && pathname === '/api/linkwarden/collections') {
      try { const settings = savedLinkwardenSettings(); return json(response, 200, { collections: storeCollectionTree(settings, await linkwarden.listCollections(settings)) }); }
      catch { return json(response, 503, { error: 'Linkwarden collections are currently unavailable.' }); }
    }
    if (request.method === 'GET' && pathname === '/api/bookmarks') {
      if (!store.getLinkwarden()) return json(response, 200, { configured: false, bookmarks: [] });
      try {
        const url = new URL(request.url, 'http://localhost');
        const settings = savedLinkwardenSettings();
        const collection = selectedCollection(url.searchParams.get('collection') ?? '', settings);
        const result = await linkwarden.getBookmarks({ ...settings, collectionId: collection.id }, { force: url.searchParams.get('refresh') === '1' });
        return json(response, 200, { configured: true, ...result });
      } catch (error) { return json(response, error.message.startsWith('Select a collection') ? 400 : 503, { configured: true, error: error.message.startsWith('Select a collection') ? error.message : 'Bookmarks are currently unavailable.' }); }
    }

    const controlToken = homeAssistantControlToken(pathname);
    if (request.method === 'POST' && controlToken) {
      let input;
      try { input = await readJson(request); }
      catch (error) { return json(response, 400, { error: error.message }); }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !['turn_on', 'turn_off'].includes(input.action)) return json(response, 400, { error: 'Home Assistant action must be turn_on or turn_off.' });
      let settings;
      try { settings = savedHomeAssistantSettings(); }
      catch { return json(response, 503, { error: HOME_ASSISTANT_UNAVAILABLE }); }
      const target = homeAssistantControls.resolve(controlToken, homeAssistantFingerprint(settings));
      if (!target || !target.available) return json(response, 404, { error: 'Home Assistant control is no longer available. Refresh devices.' });
      if (homeAssistantActions.has(controlToken)) return json(response, 409, { error: 'This Home Assistant control is already pending.' });
      homeAssistantActions.add(controlToken);
      try {
        await homeAssistant.controlEntity(settings, { entityId: target.entityId, domain: target.domain }, input.action);
        return json(response, 200, { message: `Home Assistant accepted the ${input.action === 'turn_on' ? 'turn on' : 'turn off'} action.` });
      } catch (error) {
        return json(response, 503, { error: isHomeAssistantClientError(error) ? error.message : 'Home Assistant could not complete the action.' });
      } finally { homeAssistantActions.delete(controlToken); }
    }

    const id = deviceId(pathname);
    const wakeId = deviceId(pathname, '/wake');
    try {
      if (request.method === 'POST' && pathname === '/api/devices') return json(response, 201, { device: store.create(validateDevice(await readJson(request))) });
      if (request.method === 'PUT' && pathname === '/api/linkwarden') {
        const settings = credentialsFromInput(await readJson(request));
        encryptionKey(integrationEncryptionKey);
        const collections = await linkwarden.listCollections(settings);
        const encryptedAccessToken = encryptApiKey(settings.accessToken, integrationEncryptionKey);
        store.saveLinkwarden({ ...settings, encryptedAccessToken });
        linkwarden.clearCache(); collectionSelections.clear();
        return json(response, 200, { linkwarden: linkwardenStatus(), collections: storeCollectionTree(settings, collections) });
      }
      if (request.method === 'DELETE' && pathname === '/api/linkwarden') {
        store.removeLinkwarden(); linkwarden.clearCache(); collectionSelections.clear(); return json(response, 204, {});
      }
      if (request.method === 'PUT' && pathname === '/api/home-assistant') {
        return await queueHomeAssistantMutation(async () => {
          const settings = homeAssistantCredentialsFromInput(await readJson(request));
          try { encryptionKey(integrationEncryptionKey); }
          catch { throw new Error('Home Assistant credential encryption is not configured.'); }
          homeAssistant.clearCache();
          let devices;
          try { devices = await homeAssistant.listDevices(settings, { force: true }); }
          catch (error) { throw new Error(isHomeAssistantClientError(error) ? error.message : HOME_ASSISTANT_UNAVAILABLE); }
          const encryptedAccessToken = encryptApiKey(settings.accessToken, integrationEncryptionKey);
          store.saveHomeAssistant({ ...settings, encryptedAccessToken });
          homeAssistantControls.clear();
          return json(response, 200, { homeAssistant: homeAssistantStatus(), devices: publicHomeAssistantDevices(settings, devices) });
        });
      }
      if (request.method === 'DELETE' && pathname === '/api/home-assistant') {
        return await queueHomeAssistantMutation(async () => { store.removeHomeAssistant(); homeAssistant.clearCache(); homeAssistantControls.clear(); return json(response, 204, {}); });
      }
      if (request.method === 'PUT' && pathname === '/api/calendar') {
        return await queueCalDavMutation(async () => {
          const settings = calDavCredentialsFromInput(await readJson(request));
          try { encryptionKey(integrationEncryptionKey); }
          catch { throw new Error('Calendar credential encryption is not configured.'); }
          let result;
          try { result = await calDav.test(settings); }
          catch (error) { throw new Error(isCalDavClientError(error) ? error.message : CALENDAR_UNAVAILABLE); }
          const encryptedPassword = encryptApiKey(settings.password, integrationEncryptionKey);
          store.saveCalDav({ ...settings, encryptedPassword });
          calDav.clearCache();
          return json(response, 200, { ...calDavStatus(), events: publicCalendarEvents(result.events), stale: false });
        });
      }
      if (request.method === 'DELETE' && pathname === '/api/calendar') {
        return await queueCalDavMutation(async () => { store.removeCalDav(); calDav.clearCache(); return json(response, 204, {}); });
      }
      if (request.method === 'PUT' && id) {
        if (!store.get(id)) return json(response, 404, { error: 'Device not found.' });
        return json(response, 200, { device: store.update(id, validateDevice(await readJson(request))) });
      }
      if (request.method === 'DELETE' && id) return store.remove(id) ? json(response, 204, {}) : json(response, 404, { error: 'Device not found.' });
      if (request.method === 'POST' && wakeId) {
        const device = store.get(wakeId);
        if (!device) return json(response, 404, { error: 'Device not found.' });
        const current = now();
        const last = wakeRequests.get(wakeId) ?? 0;
        const waitMs = runtimeConfig.wakeCooldownSeconds * 1_000 - (current - last);
        if (waitMs > 0) return json(response, 429, { error: `Please wait ${Math.ceil(waitMs / 1_000)} seconds before waking this device again.` });
        wakeRequests.set(wakeId, current);
        const result = await wakeExecutor({ device, port: runtimeConfig.wolPort, markWake: () => store.markWake(wakeId), audit: (outcome, detail) => store.audit(wakeId, outcome, detail) });
        if (!result.sent) return json(response, 502, { error: 'Unable to send the wake packet. Check the host network and device broadcast address.' });
        return json(response, 200, { message: `Wake packet sent to ${device.name} (${result.dispatch.sent}/${result.dispatch.attempted} Moonlight-compatible UDP datagrams). This does not confirm that it has powered on.` });
      }
    } catch (error) {
      if (String(error?.code).includes('SQLITE_CONSTRAINT') || error?.errcode === 2067) return json(response, 409, { error: 'A device already uses that MAC address.' });
      return json(response, 400, { error: error.message || 'Invalid request.' });
    }
    return json(response, 404, { error: 'Not found.' });
  }

  return http.createServer((request, response) => {
    void (async () => {
      let pathname;
      try { pathname = new URL(request.url, 'http://localhost').pathname; }
      catch { return json(response, 400, { error: 'Invalid request target.' }); }
      if (pathname.startsWith('/api/')) return handleApi(request, response, pathname);
      return serveStatic(request, response, pathname);
    })().catch(() => {
      console.error('Unexpected request handling failure.');
      if (response.destroyed || response.writableEnded) return;
      try { if (!response.headersSent) json(response, 500, { error: 'Internal server error.' }); else response.end(); }
      catch { response.destroy(); }
    });
  });
}
