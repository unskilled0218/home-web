import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createDashboardServer } from '../src/app.js';
import { createStore } from '../src/db.js';
import { decryptApiKey, encryptApiKey } from '../src/linkwarden-crypto.js';

test('stores CalDAV credentials securely and exposes only safe calendar data', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-calendar-api-'));
  const databasePath = path.join(directory, 'dashboard.db');
  const store = createStore(databasePath);
  const secret = Buffer.alloc(32, 6).toString('base64');
  const calls = [];
  let failure = null;
  let blockNext = false;
  let releaseBlocked;
  let blockedStarted;
  const upstreamEvents = [{ title: ' Planning ', start: '2026-01-02T15:00:00.000Z', end: '2026-01-02T16:00:00.000Z', allDay: false, location: ' Office ', uid: 'private-uid', href: '/dav/private.ics', raw: 'BEGIN:VCALENDAR' }];
  const calDav = {
    clearCache() { calls.push({ clear: true }); },
    async test(settings) {
      calls.push({ test: settings });
      if (failure) throw new Error(failure);
      if (blockNext) {
        blockNext = false;
        await new Promise((resolve) => { releaseBlocked = resolve; blockedStarted(); });
      }
      return { events: upstreamEvents, stale: false };
    },
    async listEvents(settings, options) {
      calls.push({ list: settings, options });
      if (failure) throw new Error(failure);
      return { events: upstreamEvents, stale: false };
    }
  };
  const server = createDashboardServer({
    runtimeConfig: { allowedHosts: ['127.0.0.1'], integrationEncryptionKey: secret, wakeCooldownSeconds: 20, wolPort: 9 },
    store,
    linkwarden: { clearCache() {}, listCollections: async () => [], getBookmarks: async () => ({ bookmarks: [], stale: false }) },
    homeAssistant: { clearCache() {} },
    calDav
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = async (pathname, { method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? {} : await response.json() };
  };

  assert.deepEqual((await api('/api/calendar/events')).body, { configured: false, events: [] });
  const credentials = { collectionUrl: 'https://baikal.example.test/dav.php/calendars/user/default', username: 'user', password: 'private-password' };
  const connected = await api('/api/calendar', { method: 'PUT', body: credentials });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.configured, true);
  assert.equal(connected.body.collectionUrl, `${credentials.collectionUrl}/`);
  assert.deepEqual(connected.body.events, [{ title: 'Planning', start: '2026-01-02T15:00:00.000Z', end: '2026-01-02T16:00:00.000Z', allDay: false, location: 'Office' }]);
  assert.equal(JSON.stringify(connected.body).includes('private-password'), false);
  assert.equal(JSON.stringify(connected.body).includes('private-uid'), false);
  assert.equal(JSON.stringify(connected.body).includes('/dav/private.ics'), false);
  assert.equal(decryptApiKey(store.getCalDav().encryptedPassword, secret), 'private-password');

  const inspector = new DatabaseSync(databasePath);
  const columns = inspector.prepare('PRAGMA table_info(caldav_config)').all().map(({ name }) => name);
  const row = inspector.prepare('SELECT * FROM caldav_config').get();
  inspector.close();
  assert.equal(columns.includes('password'), false);
  assert.equal(JSON.stringify(row).includes('private-password'), false);

  const listed = await api('/api/calendar/events?refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(calls.at(-1).options.force, true);
  assert.equal(calls.at(-1).list.password, 'private-password');
  assert.equal((await api('/api/calendar', { method: 'PUT', body: { ...credentials, password: '' } })).status, 200);
  const testCount = calls.filter(({ test: value }) => value).length;
  assert.equal((await api('/api/calendar', { method: 'PUT', body: { ...credentials, username: 'other', password: '' } })).status, 400);
  assert.equal((await api('/api/calendar', { method: 'PUT', body: { ...credentials, collectionUrl: 'https://other.example.test/calendar/', password: '' } })).status, 400);
  assert.equal(calls.filter(({ test: value }) => value).length, testCount);

  failure = 'private upstream detail';
  const failed = await api('/api/calendar', { method: 'PUT', body: { ...credentials, password: 'replacement' } });
  assert.equal(failed.status, 400);
  assert.equal(failed.body.error, 'Calendar events are currently unavailable.');
  assert.equal(decryptApiKey(store.getCalDav().encryptedPassword, secret), 'private-password');
  const unavailable = await api('/api/calendar/events');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error, 'Calendar events are currently unavailable.');
  assert.equal(JSON.stringify(unavailable.body).includes('private upstream'), false);

  failure = null;
  assert.equal((await api('/api/calendar', { method: 'DELETE' })).status, 204);
  assert.equal(store.getCalDav(), undefined);
  store.saveCalDav({ collectionUrl: 'https://baikal.example.test/calendar/', username: 'user', encryptedPassword: encryptApiKey('unreadable', Buffer.alloc(32, 7).toString('base64')) });
  assert.deepEqual((await api('/api/calendar/events')).body, { configured: false, events: [], needsReauthentication: true });
  assert.equal((await api('/api/calendar')).body.needsReauthentication, true);

  await api('/api/calendar', { method: 'DELETE' });
  blockNext = true;
  const started = new Promise((resolve) => { blockedStarted = resolve; });
  const reconnect = api('/api/calendar', { method: 'PUT', body: credentials });
  await started;
  const disconnect = api('/api/calendar', { method: 'DELETE' });
  releaseBlocked();
  assert.equal((await reconnect).status, 200);
  assert.equal((await disconnect).status, 204);
  assert.equal(store.getCalDav(), undefined);
});
