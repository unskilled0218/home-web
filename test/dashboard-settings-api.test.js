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
import { decodeStoredDashboardPreferences, normalizeDashboardPreferences, validateDashboardPreferences, legacyDashboardPreferences, PREFERENCE_KEYS } from '../public/dashboard-helpers.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';
import { initialWidgetProfile, changeWidgetLayer } from '../public/dashboard-layout.js';

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

test('new overlay fields upgrade missing values only, preserving independent profiles and strict writes', async (t) => {
  const env = await setup(t);
  const keys = ['bookmarksVisible', 'homeAssistantVisible', 'wolVisible', 'mobileBookmarksVisible', 'mobileHomeAssistantVisible', 'mobileWolVisible'];
  const preferences = normalizeDashboardPreferences({ timeVisible: false, mobileWeatherVisible: false, mobileCalendarVisible: false, bookmarkLinkSelections: [], homeAssistantDeviceSelections: ['d_' + 'a'.repeat(43)] });
  const old = { ...preferences }; for (const key of keys) delete old[key];
  assert.deepEqual(decodeStoredDashboardPreferences(old), preferences);
  for (const key of keys) { assert.throws(() => decodeStoredDashboardPreferences({ ...old, [key]: 'false' })); assert.throws(() => validateDashboardPreferences({ ...preferences, [key]: 0 })); }
  assert.throws(() => decodeStoredDashboardPreferences({ ...old, extra: true }));
  const db = new DatabaseSync(env.filename); t.after(() => db.close());
  db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 7)').run(JSON.stringify(old));
  const read = await (await env.api()).json(); assert.equal(read.revision, 7); assert.deepEqual(read.preferences, preferences);
  assert.equal(db.prepare('SELECT configuration FROM dashboard_preferences').get().configuration, JSON.stringify(old));
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: old })).status, 400);
  const next = { ...read.preferences, ...Object.fromEntries(keys.map((key) => [key, false])) };
  const saved = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: next })).json(); assert.equal(saved.revision, 8); assert.deepEqual(saved.preferences, next);
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences })).status, 409);
  const reopened = createStore(env.filename); assert.deepEqual(reopened.getDashboardPreferences().preferences, next); reopened.close();
});

test('six widget scales upgrade database reads without writes and persist explicit values on revision-checked save', async t => {
  const env = await setup(t); const db = new DatabaseSync(env.filename); t.after(() => db.close());
  const keys = ['bookmarksScale', 'mobileBookmarksScale', 'homeAssistantScale', 'mobileHomeAssistantScale', 'wolScale', 'mobileWolScale'];
  const expected = normalizeDashboardPreferences({ color: '#123456', widgetLayout: { version: 2, desktop: initialWidgetProfile('desktop'), mobile: null } });
  const old = { ...expected }; for (const key of keys) delete old[key];
  db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 7)').run(JSON.stringify(old));
  const result = await (await env.api()).json(); assert.deepEqual(result.preferences, expected); assert.equal(result.revision, 7);
  assert.deepEqual(db.prepare('SELECT configuration, revision FROM dashboard_preferences').get(), { __proto__: null, configuration: JSON.stringify(old), revision: 7 });
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: old })).status, 400);
  const next = { ...expected, ...Object.fromEntries(keys.map((key, i) => [key, .5 + i / 10])) };
  const saved = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: next })).json(); assert.deepEqual(saved.preferences, next); assert.equal(saved.revision, 8);
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: next })).status, 409);
  const reopened = createStore(env.filename); try { assert.deepEqual(reopened.getDashboardPreferences().preferences, next); } finally { reopened.close(); }
});

test('fullscreen and forecast fields upgrade stored reads only and persist explicit choices', async (t) => {
  const env = await setup(t);
  const keys = ['hideTimeFullscreen', 'hideWeatherFullscreen', 'hideCalendarFullscreen', 'hideHomeAssistantFullscreen', 'hideWolFullscreen', 'weatherHourlyVisible', 'weatherDailyVisible'];
  const preferences = normalizeDashboardPreferences({ timeVisible: false, mobileCalendarVisible: false, hideBookmarksFullscreen: true });
  const old = { ...preferences }; for (const key of keys) delete old[key];
  assert.deepEqual(decodeStoredDashboardPreferences(old), preferences);
  for (const key of keys) {
    assert.equal(preferences[key], key.startsWith('weather'), `${key} default`);
    for (const bad of ['false', null, 0]) assert.throws(() => decodeStoredDashboardPreferences({ ...old, [key]: bad }), { message: `Invalid dashboard preference: ${key}.` });
    assert.throws(() => validateDashboardPreferences({ ...preferences, [key]: 'true' }));
  }
  assert.throws(() => decodeStoredDashboardPreferences({ ...old, extra: true }));
  const db = new DatabaseSync(env.filename); t.after(() => db.close());
  db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 7)').run(JSON.stringify(old));
  const read = await (await env.api()).json(); assert.equal(read.revision, 7); assert.deepEqual(read.preferences, preferences);
  assert.equal(db.prepare('SELECT configuration FROM dashboard_preferences').get().configuration, JSON.stringify(old), 'read does not rewrite old record');
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: old })).status, 400);
  const next = { ...preferences, ...Object.fromEntries(keys.map(key => [key, !preferences[key]])) };
  const saved = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: next })).json();
  assert.equal(saved.revision, 8); assert.deepEqual(saved.preferences, next);
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences })).status, 409);
  const reopened = createStore(env.filename); assert.deepEqual(reopened.getDashboardPreferences().preferences, next); reopened.close();
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

test('stored previous preferences gain only empty selections without read writes or lost revisions', async (t) => {
  const env = await setup(t); const preferences = normalizeDashboardPreferences({ timezone: 'Asia/Tokyo', color: '#123456' });
  const previous = { ...preferences }; delete previous.homeAssistantDeviceSelections;
  const db = new DatabaseSync(env.filename); t.after(() => db.close());
  db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 7)').run(JSON.stringify(previous));
  assert.deepEqual(decodeStoredDashboardPreferences(previous), preferences);
  const snapshot = await (await env.api()).json(); assert.equal(snapshot.revision, 7); assert.deepEqual(snapshot.preferences, preferences);
  assert.equal(db.prepare('SELECT configuration FROM dashboard_preferences').get().configuration, JSON.stringify(previous));
  const selected = ['d_' + 'b'.repeat(43), 'd_' + 'a'.repeat(43)];
  const saved = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: { ...preferences, homeAssistantDeviceSelections: selected } })).json();
  assert.equal(saved.revision, 8); assert.deepEqual(saved.preferences.homeAssistantDeviceSelections, selected.toSorted());
  const same = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 8, preferences: { ...saved.preferences, homeAssistantDeviceSelections: selected } })).json(); assert.equal(same.revision, 8);
  const reopened = createStore(env.filename); assert.deepEqual(reopened.getDashboardPreferences().preferences, saved.preferences); reopened.close();
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 8, preferences: previous })).status, 400);
  for (const broken of [{ ...previous, scale: '1' }, { ...previous, extra: 1 }, { color: '#123456' }]) {
    assert.throws(() => decodeStoredDashboardPreferences(broken));
    db.prepare('UPDATE dashboard_preferences SET configuration = ?').run(JSON.stringify(broken));
    assert.equal((await env.api()).status, 503);
  }
});

test('selection validation rejects duplicates, invalid IDs and oversized arrays within bounded preference payloads', () => {
  const preferences = normalizeDashboardPreferences(); const id = 'd_' + 'a'.repeat(43);
  for (const value of [null, {}, [id, id], ['raw-device-id'], ['r_' + 'a'.repeat(43)], Array.from({ length: 257 }, (_, index) => 'd_' + String(index).padStart(43, 'a'))]) assert.throws(() => validateDashboardPreferences({ ...preferences, homeAssistantDeviceSelections: value }));
  const selections = Array.from({ length: 256 }, (_, index) => 'd_' + String(index).padStart(43, 'a'));
  const valid = validateDashboardPreferences({ ...preferences, homeAssistantDeviceSelections: selections });
  assert.equal(valid.homeAssistantDeviceSelections.length, 256);
  assert.ok(Buffer.byteLength(JSON.stringify({ preferences: valid, revision: 1, integrations: {} })) < 65536);
});

test('bookmark choices distinguish setup from empty, enforce exact records, and fit alongside maximum device choices', () => {
  const defaults = normalizeDashboardPreferences(); assert.equal(defaults.bookmarkLinkSelections, null);
  const record = { selectionId: 'b_' + 'a'.repeat(43), collectionSelectionId: 'c'.repeat(43) };
  assert.deepEqual(validateDashboardPreferences({ ...defaults, bookmarkLinkSelections: [] }).bookmarkLinkSelections, []);
  for (const invalid of [{}, false, [record, record], [{ ...record, url: 'https://private.test' }], [{ ...record, selectionId: 'raw' }], [{ ...record, collectionSelectionId: 'x' }], Array.from({ length: 257 }, () => record)]) assert.throws(() => validateDashboardPreferences({ ...defaults, bookmarkLinkSelections: invalid }));
  const bookmarkLinkSelections = Array.from({ length: 256 }, (_, index) => ({ selectionId: 'b_' + String(index).padStart(43, 'a'), collectionSelectionId: 'c'.repeat(43) }));
  const homeAssistantDeviceSelections = Array.from({ length: 256 }, (_, index) => 'd_' + String(index).padStart(43, 'a'));
  const maximum = validateDashboardPreferences({ ...defaults, bookmarkLinkSelections, homeAssistantDeviceSelections, widgetLayout: { version: 2, desktop: initialWidgetProfile('desktop'), mobile: initialWidgetProfile('mobile') } });
  assert.ok(Buffer.byteLength(JSON.stringify({ preferences: maximum, revision: 1, integrations: { linkwarden: { baseUrl: 'x'.repeat(2048), username: 'x'.repeat(120) }, calendar: { serverUrl: 'x'.repeat(2048), username: 'x'.repeat(120) }, weather: {} } })) < 65536, 'maximum choices and bounded integration metadata fit the response budget');
});

test('widget layouts upgrade without read writes and persist atomically with conflicts and stable revisions', async t => {
  const env = await setup(t); const old = normalizeDashboardPreferences({ scale: 1.2, mobileTimeVisible: false }); delete old.widgetLayout;
  const db = new DatabaseSync(env.filename); t.after(() => db.close());
  db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 7)').run(JSON.stringify(old));
  const read = await (await env.api()).json();
  assert.equal(read.revision, 7); assert.deepEqual(read.preferences.widgetLayout, { version: 2, desktop: null, mobile: null });
  assert.equal(db.prepare('SELECT configuration FROM dashboard_preferences').get().configuration, JSON.stringify(old));
  const incomplete = await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: old });
  assert.equal(incomplete.status, 400); assert.match((await incomplete.json()).error, /Reload this page/);
  const widgetLayout = { version: 2, desktop: changeWidgetLayer(initialWidgetProfile('desktop'), 'time', 'front'), mobile: initialWidgetProfile('mobile') };
  const preferences = { ...read.preferences, widgetLayout };
  const saved = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences })).json();
  assert.equal(saved.revision, 8); assert.deepEqual(saved.preferences, preferences);
  const same = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 8, preferences })).json(); assert.equal(same.revision, 8);
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: read.preferences })).status, 409);
  const unrelated = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 8, preferences: { ...preferences, color: '#123456' } })).json();
  assert.deepEqual(unrelated.preferences.widgetLayout, widgetLayout);
  const reopened = createStore(env.filename); assert.deepEqual(reopened.getDashboardPreferences().preferences, unrelated.preferences); reopened.close();
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 9, preferences: { ...preferences, widgetLayout: { ...widgetLayout, desktop: { items: [] } } } })).status, 400);
  db.prepare('UPDATE dashboard_preferences SET configuration = ?').run(JSON.stringify({ ...preferences, widgetLayout: null }));
  assert.equal((await env.api()).status, 503, 'invalid present layout is not reset to automatic');
});

test('old bookmark preference records decode without writes; explicit saves persist choices and keep conflict ownership', async (t) => {
  const env = await setup(t); const preferences = normalizeDashboardPreferences({ color: '#123456' }); const old = { ...preferences }; delete old.bookmarkLinkSelections; delete old.homeAssistantDeviceSelections;
  const db = new DatabaseSync(env.filename); t.after(() => db.close()); db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 7)').run(JSON.stringify(old));
  const read = await (await env.api()).json(); assert.equal(read.revision, 7); assert.equal(read.preferences.bookmarkLinkSelections, null); assert.deepEqual(read.preferences.homeAssistantDeviceSelections, []); assert.equal(db.prepare('SELECT configuration FROM dashboard_preferences').get().configuration, JSON.stringify(old));
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: old })).status, 400);
  const canonical = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: read.preferences })).json(); assert.equal(canonical.revision, 8); assert.equal(JSON.parse(db.prepare('SELECT configuration FROM dashboard_preferences').get().configuration).bookmarkLinkSelections, null);
  const choice = { selectionId: 'b_' + 'a'.repeat(43), collectionSelectionId: 'c'.repeat(43) };
  const selected = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 8, preferences: { ...canonical.preferences, bookmarkLinkSelections: [choice] } })).json(); assert.equal(selected.preferences.color, '#123456'); assert.deepEqual(selected.preferences.bookmarkLinkSelections, [choice]);
  assert.equal((await env.api('/api/dashboard/settings', 'PUT', { revision: 8, preferences: canonical.preferences })).status, 409);
  const reopened = createStore(env.filename); assert.deepEqual(reopened.getDashboardPreferences(), { initialized: true, revision: selected.revision, preferences: selected.preferences }); reopened.close();
  const empty = await (await env.api('/api/dashboard/settings', 'PUT', { revision: selected.revision, preferences: { ...selected.preferences, bookmarkLinkSelections: [] } })).json(); assert.deepEqual(empty.preferences.bookmarkLinkSelections, []);
});

test('top-origin layouts migrate on read without changing revision and old-coordinate writes are rejected', async t => {
  const env = await setup(t);
  const widgetLayout = { version: 1, desktop: initialWidgetProfile('desktop'), mobile: initialWidgetProfile('mobile') };
  const old = { ...normalizeDashboardPreferences({ color: '#123456' }), widgetLayout };
  const bytes = JSON.stringify(old); const db = new DatabaseSync(env.filename); t.after(() => db.close());
  db.prepare('INSERT INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 7)').run(bytes);
  const first = await (await env.api()).json(); const second = await (await env.api()).json();
  assert.deepEqual(second, first); assert.equal(first.revision, 7); assert.equal(first.preferences.widgetLayout.version, 2);
  for (const mode of ['desktop', 'mobile']) for (const [index, item] of widgetLayout[mode].items.entries()) assert.deepEqual(first.preferences.widgetLayout[mode].items[index], { ...item, y: 1_000_000 - item.y - item.h });
  assert.equal(db.prepare('SELECT configuration FROM dashboard_preferences').get().configuration, bytes, 'GET does not rewrite old coordinates');
  const rejected = await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: old });
  assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /Reload this page/);
  const saved = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 7, preferences: first.preferences })).json();
  assert.equal(saved.revision, 8); assert.deepEqual(saved.preferences, first.preferences);
  const same = await (await env.api('/api/dashboard/settings', 'PUT', { revision: 8, preferences: saved.preferences })).json(); assert.equal(same.revision, 8);
  const reopened = createStore(env.filename); assert.deepEqual(reopened.getDashboardPreferences().preferences, first.preferences); reopened.close();
});
