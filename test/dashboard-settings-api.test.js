import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { normalizeDashboardPreferences, validateDashboardPreferences, legacyDashboardPreferences, PREFERENCE_KEYS } from '../public/dashboard-helpers.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';

async function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-settings-')); const filename = path.join(directory, 'app.db'); const store = createStore(filename);
  const server = createDashboardServer({ store, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: Buffer.alloc(32, 9).toString('base64') } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (route = '/api/dashboard/settings', method = 'GET', body, headers = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { store, api, filename, base };
}

test('global schema is complete, UTC-based, strictly validated, and native-step compatible', () => {
  const defaults = normalizeDashboardPreferences(); assert.equal(defaults.timezone, 'UTC'); assert.equal(Object.hasOwn(defaults, 'location'), false);
  assert.equal(PREFERENCE_KEYS.length, Object.keys(defaults).length);
  assert.deepEqual(validateDashboardPreferences(defaults), defaults);
  assert.deepEqual(legacyDashboardPreferences({ scale: 1.25, opacity: 0.55, interval: 5.4, duration: 4.4, location: { latitude: 1, longitude: 1 } }), { ...defaults, scale: 1.3, opacity: 0.6, interval: 5, duration: 4 });
  for (const value of [null, [], {}, { unrelated: true }]) assert.equal(legacyDashboardPreferences(value), null);
  for (const override of [{ scale: 1.25 }, { scale: '1' }, { timezone: 'bad' }, { blur: 1.5 }, { mobileBookmarksMode: 'bad' }, { hideBookmarksFullscreen: 'true' }, { accessToken: 'secret' }]) assert.throws(() => validateDashboardPreferences({ ...defaults, ...override }));
});

test('uninitialized reads do not write, migration races choose one winner, and stale saves cannot replace it', async (t) => {
  const env = await setup(t); const defaults = normalizeDashboardPreferences();
  const first = await env.api(); assert.equal(first.headers.get('cache-control'), 'no-store'); assert.equal((await first.json()).initialized, false);
  const inspector = new DatabaseSync(env.filename); assert.equal(inspector.prepare('SELECT COUNT(*) AS count FROM dashboard_preferences').get().count, 0); inspector.close();
  const candidates = [{ ...defaults, color: '#123456' }, { ...defaults, color: '#abcdef' }];
  const responses = await Promise.all(candidates.map((preferences) => env.api('/api/dashboard/settings/initialize', 'POST', { preferences })));
  const snapshots = await Promise.all(responses.map((response) => response.json()));
  assert.equal(snapshots.filter((snapshot) => snapshot.created).length, 1); assert.deepEqual(snapshots[0].preferences, snapshots[1].preferences);
  const stale = await env.api('/api/dashboard/settings', 'PUT', { revision: 0, preferences: defaults }); assert.equal(stale.status, 409); assert.equal((await stale.json()).snapshot.revision, 1);
  const winner = snapshots[0];
  const same = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 1, preferences: winner.preferences })).json(); assert.equal(same.revision, 1);
  const changed = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 1, preferences: { ...winner.preferences, seconds: false } })).json(); assert.equal(changed.revision, 2);
});

test('initial migration and first normal save are atomic, and the current schema persists without replacing older records', async (t) => {
  const env = await setup(t); const old = env.store.getHomeSettings(); const defaults = normalizeDashboardPreferences();
  const actions = await Promise.all([env.api('/api/dashboard/settings', 'PUT', { revision: 0, preferences: { ...defaults, timezone: 'Asia/Tokyo' } }), env.api('/api/dashboard/settings/initialize', 'POST', { preferences: { ...defaults, color: '#123456' } })]);
  assert.ok([200, 409].includes(actions[0].status)); assert.equal(actions[1].status, 200);
  const latest = await (await env.api()).json(); assert.equal(latest.revision, 1); assert.deepEqual(env.store.getHomeSettings(), old);
  const reopened = createStore(env.filename); assert.deepEqual(reopened.getDashboardPreferences().preferences, latest.preferences); reopened.close();
});

test('preference API rejects invalid writes and unsafe origins while isolating unavailable integration metadata', async (t) => {
  const env = await setup(t); const preferences = normalizeDashboardPreferences();
  assert.equal((await env.api('/api/dashboard/settings', 'POST')).status, 405);
  assert.equal((await env.api('/api/dashboard/settings/initialize', 'GET')).status, 405);
  for (const body of [null, [], {}, { revision: -1, preferences }, { revision: 0, preferences: { ...preferences, password: 'secret' } }, { revision: 0, preferences, extra: 'bad' }]) assert.equal((await env.api('/api/dashboard/settings', 'PUT', body)).status, 400);
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 0, preferences }, { origin: 'https://bad.test' })).status, 403);
  const badHost = await new Promise((resolve, reject) => { const request = http.get(`${env.base}/api/dashboard/settings`, { headers: { host: 'bad.test' } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); });
  assert.equal(badHost, 403);
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 0, preferences, padding: 'x'.repeat(65536) })).status, 400);
  env.store.getWeatherLocation = () => { throw new Error('corrupt location'); };
  const result = await env.api('/api/dashboard/settings', 'PUT', { revision: 0, preferences }); assert.equal(result.status, 200);
  const snapshot = await result.json(); assert.equal(snapshot.integrations.weather.available, false); assert.equal(snapshot.revision, 1); assert.equal(snapshot.integrations.calendar.available, true);
  assert.equal(JSON.stringify(snapshot).includes('encryptedPassword'), false);
});

test('corrupt preference records and failed writes cannot masquerade as confirmed defaults', async (t) => {
  const env = await setup(t); const preferences = normalizeDashboardPreferences();
  const save = env.store.saveDashboardPreferences; env.store.saveDashboardPreferences = () => { throw new Error('disk'); };
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 0, preferences })).status, 503); assert.equal(env.store.getDashboardPreferences().initialized, false);
  env.store.saveDashboardPreferences = save;
  const db = new DatabaseSync(env.filename); db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 1)').run('{broken'); db.close();
  assert.equal((await env.api()).status, 503); assert.equal((await env.api('/api/dashboard/settings/initialize', 'POST', { preferences })).status, 503);
});

test('calendar event identity prevents publishing old events after a disconnect', async (t) => {
  const store = createStore(':memory:'); const key = Buffer.alloc(32, 9).toString('base64'); let release;
  store.saveCalDav({ serverUrl: 'https://cal.test/', username: 'sam', encryptedPassword: encryptApiKey('secret', key) });
  const server = createDashboardServer({ store, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: key }, calDav: { clearCache() {}, listEvents: () => new Promise((resolve) => { release = () => resolve({ events: [], stale: false }); }) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`; const pending = fetch(`${base}/api/calendar/events`); while (!release) await new Promise(setImmediate);
  await fetch(`${base}/api/calendar`, { method: 'DELETE' }); release(); const result = await pending; assert.equal(result.status, 409); assert.equal((await result.json()).code, 'CALENDAR_CONFIGURATION_CHANGED');
});
