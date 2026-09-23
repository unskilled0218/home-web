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

test('connects Home Assistant atomically and exposes only safe configuration', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-home-assistant-api-'));
  const store = createStore(path.join(directory, 'dashboard.db'));
  const secret = Buffer.alloc(32, 8).toString('base64');
  const calls = [];
  let failure = null;
  let blockNext = false;
  let releaseBlocked;
  let blockedStarted;
  const homeAssistant = {
    clearCache() { calls.push({ clear: true }); },
    async listDevices(settings, options) {
      calls.push({ settings, options });
      if (failure) throw new Error(failure);
      if (blockNext) {
        blockNext = false;
        await new Promise((resolve) => { releaseBlocked = resolve; blockedStarted(); });
      }
      return [{ name: 'Lamp', area: 'Office', disabled: false }];
    }
  };
  const server = createDashboardServer({
    runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret, wakeCooldownSeconds: 20, wolPort: 9 },
    store,
    linkwarden: { clearCache() {}, listCollections: async () => [], getBookmarks: async () => ({ bookmarks: [], stale: false }) },
    homeAssistant
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
  assert.equal(decryptApiKey(store.getHomeAssistant().encryptedAccessToken, secret), 'private-token');
  assert.equal((await api('/api/home-assistant')).body.homeAssistant.baseUrl, 'https://home.example.test');

  const listed = await api('/api/home-assistant/devices?refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(calls.at(-1).options.force, true);
  assert.equal((await api('/api/home-assistant', { method: 'PUT', body: { url: 'https://changed.example.test', accessToken: '' } })).status, 400);
  assert.equal((await api('/api/home-assistant', { method: 'PUT', body: { url: 'https://home.example.test', accessToken: '' } })).status, 200);

  failure = 'upstream private detail';
  assert.equal((await api('/api/home-assistant', { method: 'PUT', body: { url: 'https://home.example.test', accessToken: 'replacement' } })).status, 400);
  assert.equal(decryptApiKey(store.getHomeAssistant().encryptedAccessToken, secret), 'private-token');
  const unavailable = await api('/api/home-assistant/devices');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error, 'Home Assistant devices are currently unavailable.');
  assert.equal(JSON.stringify(unavailable.body).includes('private detail'), false);

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
