import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
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
import { createUnavailablePhotoLibrary } from './photo-library.js';
import { MAX_HOME_SETTINGS_BYTES, normalizeHomeSettings } from './home-settings.js';
import { validateWeatherLocation, weatherTimezone } from '../public/weather-data.js';
import { validateDashboardPreferences } from '../public/dashboard-helpers.js';
import { CONNECTION_SHUTDOWN_GRACE_MS } from './lifecycle-constants.js';
import { safeBookmarkUrl } from '../public/bookmark-data.js';
import { validateSlideshowSnapshot, validateSlideshowPhoto, validateLocalPhotoManifest } from '../public/photo-slideshow-data.js';
import { exactFields, MAX_SETTINGS_TRANSFER_BYTES, validateSettingsTransfer } from '../public/dashboard-settings-data.js';

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

export function createDashboardServer({ runtimeConfig, store, linkwarden, homeAssistant, calDav, weather, localWeather, slideshow, photoSourceEnabled = false, photoLibrary = createUnavailablePhotoLibrary(), homeAssistantControls = createHomeAssistantControlStore(), wakeExecutor = executeWakeRequest, collectionSelections = createCollectionSelectionStore(), now = Date.now, publicRoot = defaultPublicRoot }) {
  const wakeRequests = new Map();
  const integrationEncryptionKey = runtimeConfig.integrationEncryptionKey ?? runtimeConfig.linkwardenEncryptionKey;
  let homeAssistantMutation = Promise.resolve();
  let calDavMutation = Promise.resolve();
  let linkwardenMutation = Promise.resolve();
  const queueLinkwardenMutation = (operation) => {
    const result = linkwardenMutation.then(operation, operation);
    linkwardenMutation = result.catch(() => {});
    return result;
  };
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

  function linkwardenConfigurationId(saved = store.getLinkwarden()) {
    return saved ? createHash('sha256').update(JSON.stringify(['linkwarden-configuration-v1', saved.baseUrl, saved.username, saved.encryptedAccessToken])).digest('base64url') : null;
  }

  function linkwardenStatus() {
    const saved = store.getLinkwarden();
    let encryptionReady = false;
    let credentialsReadable = false;
    try { encryptionKey(integrationEncryptionKey); encryptionReady = true; if (saved) { decryptApiKey(saved.encryptedAccessToken, integrationEncryptionKey); credentialsReadable = true; } } catch { /* The optional integration remains disabled until valid credentials can be decrypted. */ }
    const configured = Boolean(saved?.username && credentialsReadable);
    return { configured, configurationId: linkwardenConfigurationId(saved), accessTokenPresent: Boolean(saved), encryptionReady, needsReauthentication: Boolean(saved) && !configured, ...(configured && { baseUrl: saved.baseUrl, username: saved.username, updatedAt: saved.updatedAt }) };
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
      selectionId: collectionSelectionId(settings, collection.id),
      collectionToken: collectionSelections.issue({ id: collection.id, fingerprint, expiresAt }),
      children: collection.children.map(tokenize)
    });
    return collections.map(tokenize);
  }

  function collectionSelectionId(settings, id) {
    return createHash('sha256').update(JSON.stringify(['linkwarden-collection-v1', settings.baseUrl, settings.username, id])).digest('base64url');
  }

  function publicBookmarks(settings, rows) {
    return rows.flatMap((row) => {
      const url = safeBookmarkUrl(row.url);
      if (!url || !Number.isSafeInteger(row.id) || row.id < 1) return [];
      const selectionId = `b_${createHash('sha256').update(JSON.stringify(['linkwarden-bookmark-v1', settings.baseUrl, settings.username, row.id])).digest('base64url')}`;
      return [{ ...row, url, selectionId }];
    });
  }

  function selectedCollection(token, settings) {
    const selection = collectionSelections.resolve(token, selectionFingerprint(settings));
    if (!selection) throw Object.assign(new Error('Select a collection from the current Linkwarden tree.'), { code: 'COLLECTION_SELECTION_EXPIRED' });
    return selection;
  }

  function linkwardenReadError(response, error, configurationId, fallback) {
    const changed = configurationId !== linkwardenConfigurationId() || error.code === 'LINKWARDEN_CONFIGURATION_CHANGED';
    const code = changed ? 'LINKWARDEN_CONFIGURATION_CHANGED' : error.code ?? 'LINKWARDEN_UNAVAILABLE';
    const status = code === 'LINKWARDEN_CONFIGURATION_CHANGED' ? 409 : code === 'COLLECTION_SELECTION_EXPIRED' ? 400 : code === 'LINKWARDEN_AUTHENTICATION_REQUIRED' ? 401 : code === 'LINKWARDEN_ACCESS_DENIED' ? 403 : 503;
    return json(response, status, { configurationId, code, error: ['COLLECTION_SELECTION_EXPIRED', 'COLLECTION_LIMIT', 'LINKWARDEN_AUTHENTICATION_REQUIRED', 'LINKWARDEN_ACCESS_DENIED'].includes(code) ? error.message : fallback, ...(status === 401 && { needsReauthentication: true }), ...(status === 403 && { accessDenied: true }) });
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

  function homeAssistantConfigurationId(saved = store.getHomeAssistant()) {
    return saved ? createHash('sha256').update(JSON.stringify(['home-assistant-configuration-v1', saved.baseUrl, saved.encryptedAccessToken])).digest('base64url') : null;
  }

  function homeAssistantStatus() {
    const saved = store.getHomeAssistant();
    let encryptionReady = false;
    let credentialsReadable = false;
    try { encryptionKey(integrationEncryptionKey); encryptionReady = true; if (saved) { decryptApiKey(saved.encryptedAccessToken, integrationEncryptionKey); credentialsReadable = true; } } catch { /* Re-authentication is required when saved credentials cannot be decrypted. */ }
    const configured = Boolean(saved && credentialsReadable);
    return { configured, configurationId: homeAssistantConfigurationId(saved), accessTokenPresent: Boolean(saved), encryptionReady, needsReauthentication: Boolean(saved) && !configured, ...(saved && { baseUrl: saved.baseUrl, updatedAt: saved.updatedAt }) };
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

  function publicHomeAssistantDevices(settings, devices, includeControls = true) {
    const fingerprint = homeAssistantFingerprint(settings);
    const expiresAt = now() + HOME_ASSISTANT_CONTROL_TTL_MS;
    const selectionId = (kind, deviceId, entityId = '') => `${kind}_${createHash('sha256').update(JSON.stringify(['home-selection-v1', kind, settings.baseUrl, deviceId, entityId])).digest('base64url')}`;
    return devices.map(({ deviceId, name, area, manufacturer, model, disabled, measurements = [], controls = [] }) => ({
      selectionId: selectionId('d', deviceId),
      name,
      area,
      ...(manufacturer && { manufacturer }),
      ...(model && { model }),
      disabled: Boolean(disabled),
      measurements: measurements.map(({ entityId, name: readingName, value, unit, deviceClass, status, available }) => ({
        selectionId: selectionId('r', deviceId, entityId),
        name: readingName,
        value,
        ...(unit && { unit }),
        ...(deviceClass && { deviceClass }),
        status,
        available: Boolean(available)
      })),
      controls: includeControls ? controls.map(({ entityId, domain, name, state }) => {
        const available = state === 'on' || state === 'off';
        const controlToken = homeAssistantControls.issue({ entityId, domain, available, fingerprint, expiresAt });
        return { controlToken, name, state, available };
      }) : []
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

  function calendarConfigurationId(saved = store.getCalDav()) {
    return saved ? createHash('sha256').update(JSON.stringify(['calendar-configuration-v1', saved.serverUrl, saved.username, saved.encryptedPassword])).digest('base64url') : null;
  }
  function calDavStatus() {
    const saved = store.getCalDav();
    let encryptionReady = false;
    let credentialsReadable = false;
    try { encryptionKey(integrationEncryptionKey); encryptionReady = true; if (saved) { decryptApiKey(saved.encryptedPassword, integrationEncryptionKey); credentialsReadable = true; } } catch { /* Re-authentication is required when saved credentials cannot be decrypted. */ }
    const configured = Boolean(saved && credentialsReadable);
    return { configured, configurationId: calendarConfigurationId(saved), passwordPresent: Boolean(saved), encryptionReady, needsReauthentication: Boolean(saved) && !configured, ...(saved && { serverUrl: saved.serverUrl, username: saved.username, updatedAt: saved.updatedAt }) };
  }

  function dashboardSnapshot(preferences = store.getDashboardPreferences()) {
    const observe = (load) => { try { return { ...load(), available: true }; } catch { return { available: false, error: 'Integration configuration is currently unavailable.' }; } };
    return { ...preferences, integrations: { weather: observe(() => store.getWeatherLocation()), calendar: observe(calDavStatus), linkwarden: observe(linkwardenStatus) } };
  }

  function savedCalDavSettings() {
    const saved = store.getCalDav();
    if (!saved) throw new Error('Calendar is not configured.');
    try { return { serverUrl: saved.serverUrl, username: saved.username, password: decryptApiKey(saved.encryptedPassword, integrationEncryptionKey) }; }
    catch { throw new Error('Calendar needs re-authentication.'); }
  }

  function calDavCredentialsFromInput(input) {
    const existing = store.getCalDav();
    const settings = normalizeCalDavCredentials(input, existing);
    if (!settings.password && existing) {
      if (settings.serverUrl !== existing.serverUrl || settings.username !== existing.username) throw new Error('A new CalDAV password is required when changing the server URL or username.');
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
    if (['/dashboard', '/dashboard/', '/dashboard.html'].includes(pathname)) {
      response.writeHead(308, { Location: '/', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end();
      return;
    }
    const requested = pathname === '/' ? '/index.html' : pathname;
    const target = path.resolve(publicRoot, `.${requested}`);
    if (!target.startsWith(`${publicRoot}${path.sep}`)) return json(response, 404, { error: 'Not found.' });
    try {
      const content = await readFile(target);
      const extension = path.extname(target);
      const cacheControl = ['.html', '.js'].includes(extension) ? 'no-store' : 'no-cache';
      response.writeHead(200, { 'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cacheControl });
      response.end(content);
    } catch { json(response, 404, { error: 'Not found.' }); }
  }

  async function servePhoto(response, token) {
    const photo = await photoLibrary.open(token);
    if (!photo) return json(response, 404, { error: 'Photo not found.' });
    response.writeHead(200, { 'Content-Type': photo.mime, 'Content-Length': photo.size, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
    await pipeline(photo.stream, response);
  }

  async function handleApi(request, response, pathname) {
    if (!isTrustedAddress(request.socket.remoteAddress)) return json(response, 403, { error: 'This service only accepts local-network requests.' });
    if (!apiRequestAllowed(request, runtimeConfig.allowedHosts)) return json(response, 403, { error: 'Request host or origin is not allowed.' });
    if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok' });
    if (pathname === '/api/dashboard/configuration') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      const observe = load => { try { return { ...load(), available: true }; } catch { return { available: false }; } };
      return json(response, 200, { calendar: observe(calDavStatus), linkwarden: observe(linkwardenStatus) });
    }
    if (['/api/dashboard/settings/export', '/api/dashboard/settings/import'].includes(pathname)) {
      const exporting = pathname.endsWith('/export');
      if (request.method !== (exporting ? 'GET' : 'POST')) return json(response, 405, { error: 'Method not allowed.' });
      let input;
      if (!exporting) {
        try {
          input = await readJson(request, MAX_SETTINGS_TRANSFER_BYTES);
          if (!exactFields(input, ['settings', 'preferencesRevision', 'weatherRevision']) || !['preferencesRevision', 'weatherRevision'].every(key => Number.isSafeInteger(input[key]) && input[key] >= 0)) throw new Error('Invalid settings import revisions.');
          input.settings = validateSettingsTransfer(input.settings);
        } catch (error) { return json(response, 400, { error: error.message }); }
      }
      try {
        if (exporting) { response.setHeader('Content-Disposition', 'attachment; filename="dashboard-global-settings.json"'); return json(response, 200, store.exportDashboardSettings().settings); }
        const result = store.importDashboardSettings(input.settings, input.preferencesRevision, input.weatherRevision);
        if (!result) return json(response, 409, { error: 'Global settings changed. Reload before importing.' });
        try { slideshow?.configure(result.preferences.preferences); } catch { /* The settings transaction is already committed. */ }
        try { weather?.reloadLocation(result.weather); } catch { /* A later service refresh can recover committed configuration. */ }
        return json(response, 200, { snapshot: dashboardSnapshot(result.preferences), weatherRevision: result.weatherRevision });
      } catch { return json(response, 503, { error: 'Global settings transfer is unavailable.' }); }
    }
    if (pathname === '/api/weather/local') {
      if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
      let input;
      try { input = await readJson(request, 2048); if (!exactFields(input, ['location', 'timezone'])) throw new Error('Invalid Local weather query.'); input.location = validateWeatherLocation(input.location); input.timezone = weatherTimezone(input.timezone); }
      catch (error) { return json(response, 400, { error: error.message }); }
      try { if (!localWeather) throw new Error('Unavailable service.'); return json(response, 200, localWeather.query(input.location, input.timezone)); }
      catch (error) { return json(response, error.status === 429 ? 429 : 503, { error: 'Local weather is unavailable. Retry later.' }); }
    }
    if (pathname === '/api/dashboard/photos/local') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      try {
        const result = photoSourceEnabled ? await photoLibrary.list() : { available: false, photos: [] };
        const photos = result.available ? result.photos.slice(0, 100).flatMap(photo => { try { return [validateSlideshowPhoto(photo)]; } catch { return []; } }) : [];
        return json(response, 200, validateLocalPhotoManifest({ version: 1, enabled: photoSourceEnabled, available: Boolean(result.available), count: photos.length, photos }));
      } catch { return json(response, 503, { error: 'Local photos are unavailable.' }); }
    }
    if (['/api/dashboard/settings', '/api/dashboard/settings/initialize'].includes(pathname)) {
      const initialize = pathname.endsWith('/initialize');
      if (!(initialize ? request.method === 'POST' : ['GET', 'PUT'].includes(request.method))) return json(response, 405, { error: 'Method not allowed.' });
      if (request.method === 'GET') {
        try { return json(response, 200, dashboardSnapshot()); } catch { return json(response, 503, { error: 'Shared preferences could not be loaded.' }); }
      }
      let input;
      try {
        input = await readJson(request, MAX_HOME_SETTINGS_BYTES);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => ![...(initialize ? [] : ['revision']), 'preferences'].includes(key))) throw new Error('Invalid shared settings request.');
        validateDashboardPreferences(input.preferences);
        if (!initialize && (!Number.isSafeInteger(input.revision) || input.revision < 0)) throw new Error('Invalid shared settings revision.');
      } catch (error) { return json(response, 400, { error: error.message }); }
      try {
        const saved = initialize ? store.initializeDashboardPreferences(input.preferences) : store.saveDashboardPreferences(input.preferences, input.revision);
        if (saved && slideshow) { try { slideshow.configure(saved.preferences); } catch { /* Persistence already committed; do not report the save as failed. */ } }
        return saved ? json(response, 200, dashboardSnapshot(saved)) : json(response, 409, { error: 'Shared preferences changed in another browser. Reload shared preferences before reapplying changes.', snapshot: dashboardSnapshot() });
      } catch { return json(response, 503, { error: 'Shared preferences could not be saved.' }); }
    }
    if (['/api/weather', '/api/weather/location', '/api/weather/refresh'].includes(pathname)) {
      const method = pathname === '/api/weather' ? 'GET' : pathname.endsWith('/location') ? 'PUT' : 'POST';
      if (request.method !== method) return json(response, 405, { error: 'Method not allowed.' });
      if (!weather) return json(response, 503, { error: 'Weather service is unavailable.' });
      let input; let timezone;
      try {
        if (method === 'GET') timezone = weatherTimezone(new URL(request.url, 'http://localhost').searchParams.get('timezone') ?? 'UTC');
        else {
          input = await readJson(request);
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid weather request.');
          if (method === 'PUT') {
            if (Object.keys(input).length !== 2 || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error('Weather location requires a valid revision.');
            input.location = validateWeatherLocation(input.location);
          } else {
            if (Object.keys(input).length !== 1 || !('timezone' in input)) throw new Error('Weather refresh requires a timezone.');
            timezone = weatherTimezone(input.timezone);
          }
        }
      } catch (error) { return json(response, 400, { error: error.message }); }
      try {
        if (method === 'GET') return json(response, 200, weather.snapshot(timezone));
        if (method === 'POST') return json(response, 202, weather.ensureFresh(timezone));
        const saved = weather.saveLocation(input.location, input.revision);
        return saved ? json(response, 200, saved) : json(response, 409, { error: 'Weather location changed on another device. Reload and select the location again.' });
      } catch { return json(response, 503, { error: 'Saved weather could not be loaded or updated.' }); }
    }
    if (pathname === '/api/dashboard/slideshow') {
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      try {
        if (!slideshow) throw new Error('Slideshow is unavailable.');
        return json(response, 200, validateSlideshowSnapshot(slideshow.snapshot()));
      } catch { return json(response, 503, { error: 'Slideshow is unavailable.' }); }
    }
    if (pathname === '/api/home/settings') {
      if (request.method === 'GET') {
        try { return json(response, 200, store.getHomeSettings()); }
        catch { return json(response, 503, { error: 'Saved home settings could not be loaded.' }); }
      }
      if (request.method === 'PUT') {
        let input;
        try { input = normalizeHomeSettings(await readJson(request, MAX_HOME_SETTINGS_BYTES)); }
        catch (error) { return json(response, 400, { error: error.message }); }
        try {
          store.getHomeSettings();
          const saved = store.saveHomeSettings(input);
          return saved ? json(response, 200, saved) : json(response, 409, { error: 'Home settings changed on another device. Reload before reapplying your changes.' });
        } catch { return json(response, 503, { error: 'Home settings could not be saved.' }); }
      }
      return json(response, 405, { error: 'Method not allowed.' });
    }
    if (request.method === 'GET' && pathname === '/api/dashboard/photos') {
      try { return json(response, 200, await photoLibrary.list()); }
      catch { return json(response, 200, { available: false, photos: [] }); }
    }
    const photoToken = /^\/api\/dashboard\/photos\/([A-Za-z0-9_-]{16,128})$/.exec(pathname)?.[1];
    if (request.method === 'GET' && photoToken) return servePhoto(response, photoToken);
    if (request.method === 'GET' && pathname === '/api/devices') return json(response, 200, { devices: store.list() });
    if (request.method === 'GET' && pathname === '/api/linkwarden') return json(response, 200, { linkwarden: linkwardenStatus() });
    if (request.method === 'GET' && pathname === '/api/home-assistant') return json(response, 200, { homeAssistant: homeAssistantStatus() });
    if (request.method === 'GET' && pathname === '/api/calendar') return json(response, 200, calDavStatus());
    if (request.method === 'GET' && pathname === '/api/calendar/events') {
      const status = calDavStatus();
      if (!status.configured) return json(response, 200, { configured: false, configurationId: status.configurationId, events: [], ...(status.needsReauthentication && { needsReauthentication: true }) });
      try {
        const url = new URL(request.url, 'http://localhost');
        const result = await calDav.listEvents(savedCalDavSettings(), { force: url.searchParams.get('refresh') === '1' });
        if (status.configurationId !== calendarConfigurationId()) return json(response, 409, { code: 'CALENDAR_CONFIGURATION_CHANGED', error: 'Calendar configuration changed. Reload its status.' });
        return json(response, 200, { configured: true, configurationId: status.configurationId, events: publicCalendarEvents(result.events), stale: result.stale === true });
      } catch (error) {
        if (status.configurationId !== calendarConfigurationId()) return json(response, 409, { code: 'CALENDAR_CONFIGURATION_CHANGED', error: 'Calendar configuration changed. Reload its status.' });
        if (isCalDavClientError(error) && error.kind === 'authentication') return json(response, 401, { configured: true, configurationId: status.configurationId, needsReauthentication: true, error: 'Calendar needs re-authentication.' });
        if (isCalDavClientError(error) && error.kind === 'authorization') return json(response, 403, { configured: true, configurationId: status.configurationId, accessDenied: true, error: error.message });
        return json(response, 503, { configured: true, configurationId: status.configurationId, error: CALENDAR_UNAVAILABLE });
      }
    }
    if (request.method === 'GET' && pathname === '/api/home-assistant/devices') {
      const status = homeAssistantStatus();
      const configurationId = status.configurationId;
      const changed = () => configurationId !== homeAssistantConfigurationId();
      const conflict = () => json(response, 409, { configurationId, code: 'HOME_ASSISTANT_CONFIGURATION_CHANGED', error: 'Home Assistant configuration changed. Reload its status.' });
      if (!status.configured) return json(response, 200, { configured: false, configurationId, devices: [], ...(status.needsReauthentication && { needsReauthentication: true }) });
      try {
        const url = new URL(request.url, 'http://localhost');
        const settings = savedHomeAssistantSettings();
        const devices = await homeAssistant.listDevices(settings, { force: url.searchParams.get('refresh') === '1' });
        if (changed()) return conflict();
        return json(response, 200, { configured: true, configurationId, devices: publicHomeAssistantDevices(settings, devices, url.searchParams.get('controls') !== '0') });
      } catch (error) { return changed() ? conflict() : json(response, 503, { configured: true, configurationId, error: isHomeAssistantClientError(error) ? error.message : HOME_ASSISTANT_UNAVAILABLE }); }
    }
    if (request.method === 'GET' && pathname === '/api/linkwarden/collections') {
      const configurationId = linkwardenConfigurationId();
      try {
        const settings = savedLinkwardenSettings(); const collections = await linkwarden.listCollections(settings);
        if (configurationId !== linkwardenConfigurationId()) return json(response, 409, { code: 'LINKWARDEN_CONFIGURATION_CHANGED', error: 'Linkwarden source changed. Reload the connection.' });
        return json(response, 200, { configurationId, collections: storeCollectionTree(settings, collections) });
      } catch (error) { return linkwardenReadError(response, error, configurationId, 'Linkwarden collections are currently unavailable.'); }
    }
    if (request.method === 'GET' && pathname === '/api/bookmarks') {
      const configurationId = linkwardenConfigurationId();
      if (!configurationId) return json(response, 200, { configured: false, configurationId: null, bookmarks: [] });
      try {
        const url = new URL(request.url, 'http://localhost');
        const settings = savedLinkwardenSettings();
        const collection = selectedCollection(url.searchParams.get('collection') ?? '', settings);
        const result = await linkwarden.getBookmarks({ ...settings, collectionId: collection.id }, { force: url.searchParams.get('refresh') === '1' });
        if (configurationId !== linkwardenConfigurationId()) return json(response, 409, { code: 'LINKWARDEN_CONFIGURATION_CHANGED', error: 'Linkwarden source changed. Reload the connection.' });
        return json(response, 200, { configured: true, configurationId, ...result, collectionSelectionId: collectionSelectionId(settings, collection.id), bookmarks: publicBookmarks(settings, result.bookmarks) });
      } catch (error) { return linkwardenReadError(response, error, configurationId, 'Bookmarks are currently unavailable.'); }
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
        return await queueLinkwardenMutation(async () => {
          const settings = credentialsFromInput(await readJson(request));
          encryptionKey(integrationEncryptionKey);
          const collections = await linkwarden.listCollections(settings, { provisional: true });
          const encryptedAccessToken = encryptApiKey(settings.accessToken, integrationEncryptionKey);
          store.saveLinkwarden({ ...settings, encryptedAccessToken });
          linkwarden.clearCache(); collectionSelections.clear();
          const status = linkwardenStatus();
          return json(response, 200, { linkwarden: status, configurationId: status.configurationId, collections: storeCollectionTree(settings, collections) });
        });
      }
      if (request.method === 'DELETE' && pathname === '/api/linkwarden') {
        return await queueLinkwardenMutation(() => { store.removeLinkwarden(); linkwarden.clearCache(); collectionSelections.clear(); return json(response, 204, {}); });
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

  const active = new Set(); const sockets = new Set(); let stopping = false; let drain;
  const server = http.createServer((request, response) => {
    if (stopping) { response.setHeader('Connection', 'close'); return json(response, 503, { error: 'Dashboard is shutting down.' }); }
    const operation = Promise.resolve().then(async () => {
      let pathname;
      try { pathname = new URL(request.url, 'http://localhost').pathname; }
      catch { return json(response, 400, { error: 'Invalid request target.' }); }
      if (pathname.startsWith('/api/')) return handleApi(request, response, pathname);
      return serveStatic(request, response, pathname);
    }).catch(() => {
      console.error('Unexpected request handling failure.');
      if (response.destroyed || response.writableEnded) return;
      try { if (!response.headersSent) json(response, 500, { error: 'Internal server error.' }); else response.end(); }
      catch { response.destroy(); }
    }).finally(() => active.delete(operation));
    active.add(operation);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.lifecycle = {
    shutdown({ graceMs = CONNECTION_SHUTDOWN_GRACE_MS, schedule = setTimeout, cancel = clearTimeout } = {}) {
      if (drain) return drain;
      stopping = true;
      drain = (async () => {
        let deadline;
        const closed = new Promise((resolve, reject) => {
          deadline = schedule(() => { for (const socket of sockets) socket.destroy(); }, graceMs);
          server.close((error) => { cancel(deadline); if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve(); });
          server.closeIdleConnections();
        });
        const [closure] = await Promise.allSettled([closed, Promise.allSettled([...active])]);
        if (closure.status === 'rejected') throw closure.reason;
      })();
      return drain;
    },
    get activeRequests() { return active.size; },
    get stopping() { return stopping; }
  };
  return server;
}
