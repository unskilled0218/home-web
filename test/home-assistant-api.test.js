import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createDashboardServer } from '../src/app.js';
import { createStore } from '../src/db.js';
import { decryptApiKey, encryptApiKey } from '../src/linkwarden-crypto.js';
import { homeAssistantWebSocketError } from '../src/home-assistant.js';
import { createHomeAssistantControlStore } from '../src/home-assistant-controls.js';

test('connects Home Assistant atomically and exposes only safe configuration', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-home-assistant-api-'));
  const store = createStore(path.join(directory, 'dashboard.db'));
  const secret = Buffer.alloc(32, 8).toString('base64');
  const calls = [];
  let failure = null;
  let blockNext = false;
  let blockControl = false;
  let releaseBlocked;
  let blockedStarted;
  let releaseControl;
  let controlStarted;
  let actionFailure = null;
  let readingValue = '20';
  const homeAssistant = {
    clearCache() { calls.push({ clear: true }); },
    async listDevices(settings, options) {
      calls.push({ settings, options });
      if (failure) throw failure instanceof Error ? failure : new Error(failure);
      if (blockNext) {
        blockNext = false;
        await new Promise((resolve) => { releaseBlocked = resolve; blockedStarted(); });
      }
      return [{ deviceId: 'device-private', name: 'Lamp', area: 'Office', disabled: false, measurements: [
        { entityId: 'sensor.private_temperature', name: 'Temperature', value: readingValue, unit: '°C', deviceClass: 'temperature', status: 'available', available: true, privateAttribute: 'private-reading-detail' },
        { entityId: 'sensor.offline', name: 'Offline sensor', value: null, deviceClass: 'humidity', status: 'unavailable', available: false }
      ], controls: [
        { entityId: 'light.office', domain: 'light', name: 'Office lamp', state: 'off' },
        { entityId: 'switch.unavailable', domain: 'switch', name: 'Unavailable switch', state: 'unavailable' }
      ] }];
    },
    async controlEntity(settings, target, action) {
      calls.push({ settings, target, action });
      if (actionFailure) throw actionFailure;
      if (blockControl) {
        blockControl = false;
        await new Promise((resolve) => { releaseControl = resolve; controlStarted(); });
      }
      readingValue = action === 'turn_on' ? '21' : '19';
    }
  };
  const server = createDashboardServer({
    runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret, wakeCooldownSeconds: 20, wolPort: 9 },
    store,
    linkwarden: { clearCache() {}, listCollections: async () => [], getBookmarks: async () => ({ bookmarks: [], stale: false }) },
    homeAssistant,
    homeAssistantControls: createHomeAssistantControlStore()
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = async (pathname, { method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? {} : await response.json() };
  };

  assert.deepEqual((await api('/api/home-assistant/devices')).body, { configured: false, devices: [] });
  const connected = await api('/api/home-assistant', { method: 'PUT', body: { url: 'https://home.example.test', accessToken: 'private-token' } });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.homeAssistant.configured, true);
  assert.equal(JSON.stringify(connected.body).includes('private-token'), false);
  assert.equal(JSON.stringify(connected.body).includes('device-private'), false);
  assert.equal(JSON.stringify(connected.body).includes('light.office'), false);
  assert.equal(JSON.stringify(connected.body).includes('sensor.private_temperature'), false);
  assert.equal(JSON.stringify(connected.body).includes('private-reading-detail'), false);
  assert.match(connected.body.devices[0].selectionId, /^d_[A-Za-z0-9_-]{43}$/);
  for (const reading of connected.body.devices[0].measurements) assert.match(reading.selectionId, /^r_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(connected.body.devices[0].measurements.map(({ selectionId, ...reading }) => reading), [
    { name: 'Temperature', value: '20', unit: '°C', deviceClass: 'temperature', status: 'available', available: true },
    { name: 'Offline sensor', value: null, deviceClass: 'humidity', status: 'unavailable', available: false }
  ]);
  assert.equal(Object.hasOwn(connected.body.devices[0].measurements[0], 'controlToken'), false);
  const controlToken = connected.body.devices[0].controls[0].controlToken;
  const unavailableToken = connected.body.devices[0].controls[1].controlToken;
  assert.match(controlToken, /^[A-Za-z0-9_-]+$/);
  assert.equal(connected.body.devices[0].controls[0].available, true);
  assert.equal(connected.body.devices[0].controls[1].available, false);
  assert.equal(decryptApiKey(store.getHomeAssistant().encryptedAccessToken, secret), 'private-token');
  assert.equal((await api('/api/home-assistant')).body.homeAssistant.baseUrl, 'https://home.example.test');

  assert.equal((await api(`/api/home-assistant/controls/${controlToken}`, { method: 'POST', body: { action: 'turn_on' } })).status, 200);
  assert.deepEqual({ entityId: calls.at(-1).target.entityId, domain: calls.at(-1).target.domain }, { entityId: 'light.office', domain: 'light' });
  assert.equal(calls.at(-1).action, 'turn_on');
  assert.equal((await api(`/api/home-assistant/controls/${unavailableToken}`, { method: 'POST', body: { action: 'turn_on' } })).status, 404);
  assert.equal((await api('/api/home-assistant/controls/forged-control-token', { method: 'POST', body: { action: 'turn_on' } })).status, 404);
  assert.equal((await api(`/api/home-assistant/controls/${connected.body.devices[0].selectionId}`, { method: 'POST', body: { action: 'turn_on' } })).status, 404);
  assert.equal((await api(`/api/home-assistant/controls/${controlToken}`, { method: 'POST', body: { action: 'toggle', extra: true } })).status, 400);

  blockControl = true;
  const actionStarted = new Promise((resolve) => { controlStarted = resolve; });
  const pendingAction = api(`/api/home-assistant/controls/${controlToken}`, { method: 'POST', body: { action: 'turn_off' } });
  await actionStarted;
  assert.equal((await api(`/api/home-assistant/controls/${controlToken}`, { method: 'POST', body: { action: 'turn_off' } })).status, 409);
  releaseControl();
  assert.equal((await pendingAction).status, 200);

  actionFailure = homeAssistantWebSocketError({ error: { code: 'PRIVATE_UPSTREAM', message: 'private action detail' } });
  const failedAction = await api(`/api/home-assistant/controls/${controlToken}`, { method: 'POST', body: { action: 'turn_on' } });
  assert.equal(failedAction.status, 503);
  assert.equal(JSON.stringify(failedAction.body).includes('private action detail'), false);
  actionFailure = null;

  const listed = await api('/api/home-assistant/devices?refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(calls.at(-1).options.force, true);
  assert.equal(listed.body.devices[0].measurements[0].value, '19');
  assert.equal(listed.body.devices[0].selectionId, connected.body.devices[0].selectionId);
  assert.deepEqual(listed.body.devices[0].measurements.map((item) => item.selectionId), connected.body.devices[0].measurements.map((item) => item.selectionId));
  assert.equal((await api('/api/home-assistant', { method: 'PUT', body: { url: 'https://changed.example.test', accessToken: '' } })).status, 400);
  assert.equal((await api('/api/home-assistant', { method: 'PUT', body: { url: 'https://home.example.test', accessToken: '' } })).status, 200);
  assert.equal((await api(`/api/home-assistant/controls/${controlToken}`, { method: 'POST', body: { action: 'turn_on' } })).status, 404);

  failure = 'upstream private detail';
  const failedConnect = await api('/api/home-assistant', { method: 'PUT', body: { url: 'https://home.example.test', accessToken: 'replacement' } });
  assert.equal(failedConnect.status, 400);
  assert.equal(failedConnect.body.error, 'Home Assistant devices are currently unavailable.');
  assert.equal(JSON.stringify(failedConnect.body).includes('private detail'), false);
  assert.equal(decryptApiKey(store.getHomeAssistant().encryptedAccessToken, secret), 'private-token');
  const unavailable = await api('/api/home-assistant/devices');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error, 'Home Assistant devices are currently unavailable.');
  assert.equal(JSON.stringify(unavailable.body).includes('private detail'), false);

  failure = homeAssistantWebSocketError({ error: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'private detail' } });
  const certificateFailure = await api('/api/home-assistant/devices');
  assert.equal(certificateFailure.status, 503);
  assert.match(certificateFailure.body.error, /certificate is not trusted.*NODE_EXTRA_CA_CERTS/);
  assert.equal(JSON.stringify(certificateFailure.body).includes('private detail'), false);

  assert.equal((await api('/api/home-assistant', { method: 'DELETE' })).status, 204);
  assert.equal(store.getHomeAssistant(), undefined);
  assert.equal((await api('/api/home-assistant')).body.homeAssistant.configured, false);

  failure = null;
  blockNext = true;
  const started = new Promise((resolve) => { blockedStarted = resolve; });
  const reconnect = api('/api/home-assistant', { method: 'PUT', body: { url: 'https://home.example.test', accessToken: 'race-token' } });
  await started;
  const disconnect = api('/api/home-assistant', { method: 'DELETE' });
  releaseBlocked();
  assert.equal((await reconnect).status, 200);
  assert.equal((await disconnect).status, 204);
  assert.equal(store.getHomeAssistant(), undefined);

  store.saveHomeAssistant({ baseUrl: 'https://home.example.test', encryptedAccessToken: encryptApiKey('unreadable', Buffer.alloc(32, 9).toString('base64')) });
  const needsReauthentication = await api('/api/home-assistant/devices');
  assert.deepEqual(needsReauthentication.body, { configured: false, devices: [], needsReauthentication: true });

  await api('/api/home-assistant', { method: 'DELETE' });
  const payload = JSON.stringify({ url: 'https://home.example.test', accessToken: 'slow-token' });
  let request;
  const slowConnect = new Promise((resolve, reject) => {
    request = http.request(`${baseUrl}/api/home-assistant`, { method: 'PUT', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  request.write(payload.slice(0, 10));
  await delay(20);
  const orderedDisconnect = api('/api/home-assistant', { method: 'DELETE' });
  request.end(payload.slice(10));
  assert.equal(await slowConnect, 200);
  assert.equal((await orderedDisconnect).status, 204);
  assert.equal(store.getHomeAssistant(), undefined);
});

test('selection identities survive renames, reordering and token rotation but are scoped to the server', async (t) => {
  const store = createStore(':memory:'); const secret = Buffer.alloc(32, 7).toString('base64');
  let devices = [{ deviceId: 'device-a', name: 'Original', area: 'Office', measurements: [{ entityId: 'sensor.a', name: 'A', value: '1', status: 'available', available: true }, { entityId: 'sensor.b', name: 'B', value: '2', status: 'available', available: true }] }, { deviceId: 'device-b', name: 'Original', area: 'Office', measurements: [] }];
  const server = createDashboardServer({ store, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret }, homeAssistant: { listDevices: async () => devices, clearCache() {} } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const connect = async (url, accessToken) => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/home-assistant`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, accessToken }) })).json()).devices;
  const first = await connect('https://home.test', 'one'); assert.notEqual(first[0].selectionId, first[1].selectionId);
  devices[0].name = 'Renamed'; devices[0].area = 'Kitchen'; devices[0].measurements[0].name = 'Renamed reading'; devices[0].measurements.reverse(); devices.reverse();
  const second = await connect('https://home.test', 'two'); assert.equal(second[1].selectionId, first[0].selectionId); assert.equal(second[1].measurements[1].selectionId, first[0].measurements[0].selectionId);
  const third = await connect('https://other.test', 'two'); assert.notEqual(third[1].selectionId, first[0].selectionId); assert.notEqual(third[1].measurements[1].selectionId, first[0].measurements[0].selectionId);
});
