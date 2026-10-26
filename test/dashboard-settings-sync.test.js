import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsSync, SHARED_SETTINGS_KEY } from '../public/dashboard-settings-sync.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { initialWidgetProfile } from '../public/dashboard-layout.js';

const snapshot = (overrides = {}) => ({ initialized: true, revision: 1, preferences: normalizeDashboardPreferences(), integrations: { weather: { available: true, revision: 0, location: null }, calendar: { available: true, configured: false, configurationId: null }, linkwarden: { available: true, configured: false, configurationId: null } }, ...overrides });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function setup(t, { handler, values = new Map(), brokenStorage = false } = {}) {
  const calls = []; const applied = []; const observed = []; const tasks = new Map(); const epochs = { weather: 0, calendar: 0, linkwarden: 0 }; let key = 0;
  const storage = { getItem: (name) => values.get(name) ?? null, setItem(name, value) { if (brokenStorage) throw new Error('storage'); values.set(name, value); }, removeItem: (name) => values.delete(name) };
  const client = createSettingsSync({ storage, schedule(fn, delay) { tasks.set(++key, { fn, delay }); return key; }, cancel(id) { tasks.delete(id); }, captureObservers() { return Object.fromEntries(Object.entries(epochs).map(([name, epoch]) => [name, (metadata) => { if (epochs[name] === epoch) observed.push({ name, metadata }); }])); }, onSnapshot(value, observers) { applied.push(value); for (const [name, apply] of Object.entries(observers)) apply(value.integrations[name]); }, fetchImpl: async (url, options) => { calls.push({ url, options }); return handler ? handler(url, options) : Response.json(snapshot()); } });
  t.after(() => client.dispose());
  return { client, values, calls, applied, observed, epochs, tasks, run(delay) { const [id, task] = [...tasks].find(([, value]) => value.delay === delay) ?? []; assert.ok(task, `timer ${delay} exists`); tasks.delete(id); task.fn(); } };
}

test('one settings owner coalesces reads, polls at five seconds, pauses, and resumes', async (t) => {
  let release; const env = setup(t, { handler: () => new Promise((resolve) => { release = () => resolve(Response.json(snapshot())); }) });
  const first = env.client.start(); const second = env.client.refresh(); assert.equal(first, second); assert.equal(env.calls.length, 1);
  release(); await first; assert.equal(env.tasks.size, 1); assert.equal(env.client.getState().confirmed, true);
  env.client.setVisible(false); assert.equal(env.tasks.size, 0);
  env.client.setVisible(true); release(); await settle(); assert.equal(env.tasks.size, 1); assert.equal(env.calls.length, 2);
  env.run(5000); release(); await settle(); assert.equal(env.calls.length, 3); assert.equal(env.tasks.size, 1);
});

test('Global reads preserve legacy Local data and never publish it to an uninitialized server', async (t) => {
  const values = new Map([['dashboard.preferences.v1', JSON.stringify({ color: '#123456', timeScale: 1.25 })]]);
  const winner = snapshot({ preferences: normalizeDashboardPreferences({ color: '#abcdef' }) });
  const env = setup(t, { values, handler: (url) => Response.json(url.endsWith('/initialize') ? { ...winner, created: false } : snapshot({ initialized: false, revision: 0 })) });
  await env.client.start(); assert.equal(env.calls.length, 1); assert.equal(env.applied[0].preferences.color, '#000000'); assert.equal(values.has('dashboard.preferences.v1'), true);
  assert.equal(values.has(SHARED_SETTINGS_KEY), false); assert.equal(env.client.getState().snapshot.initialized, false);
  const fresh = setup(t, { values, handler: () => Response.json(snapshot({ preferences: normalizeDashboardPreferences({ color: '#987654' }) })) });
  assert.equal(fresh.client.getState().cache, false); await fresh.client.start(); assert.equal(fresh.calls.length, 1); assert.equal(fresh.client.getState().snapshot.preferences.color, '#987654');
});

test('fresh uninitialized preview leaves storage unchanged and reset authority clears an older cache', async (t) => {
  const values = new Map([[SHARED_SETTINGS_KEY, JSON.stringify({ schema: 1, initialized: true, revision: 40, preferences: normalizeDashboardPreferences({ color: '#123456' }) })]]);
  const env = setup(t, { values, handler: () => Response.json(snapshot({ initialized: false, revision: 0 })) });
  await env.client.start(); assert.equal(env.calls.length, 1); assert.equal(values.has(SHARED_SETTINGS_KEY), false); assert.equal(env.client.getState().snapshot.revision, 0);
});

test('old confirmed caches gain visibility defaults and remote profiles remain authoritative', async (t) => {
  const old = normalizeDashboardPreferences({ timeVisible: false, mobileCalendarVisible: false });
  for (const key of ['bookmarksVisible', 'homeAssistantVisible', 'wolVisible', 'mobileBookmarksVisible', 'mobileHomeAssistantVisible', 'mobileWolVisible']) delete old[key];
  const values = new Map([[SHARED_SETTINGS_KEY, JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: old })]]);
  const remote = normalizeDashboardPreferences({ bookmarksVisible: false, mobileHomeAssistantVisible: false });
  const env = setup(t, { values, handler: () => Response.json(snapshot({ revision: 8, preferences: remote })) });
  assert.equal(env.client.getState().cache, true); assert.equal(env.client.getState().snapshot.preferences.bookmarksVisible, true); assert.equal(env.client.getState().snapshot.preferences.timeVisible, false);
  await env.client.start(); assert.deepEqual(env.client.getState().snapshot.preferences, remote); assert.equal(env.calls.length, 1); assert.equal(env.tasks.size, 1);
});

test('old confirmed caches gain scale defaults without read writes and reject incomplete live snapshots', async t => {
  const expected = normalizeDashboardPreferences({ color: '#123456', seconds: false }); const old = { ...expected };
  for (const key of ['bookmarksScale', 'mobileBookmarksScale', 'homeAssistantScale', 'mobileHomeAssistantScale', 'wolScale', 'mobileWolScale']) delete old[key];
  const values = new Map([[SHARED_SETTINGS_KEY, JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: old })]]); const before = [...values];
  const env = setup(t, { values, handler: () => Response.json(snapshot({ revision: 8, preferences: old })) });
  assert.deepEqual(env.client.getState().snapshot.preferences, expected); assert.equal(env.client.getState().cache, true); assert.deepEqual([...values], before);
  await env.client.start(); assert.equal(env.client.getState().confirmed, false); assert.deepEqual([...values], before);
  const remote = normalizeDashboardPreferences({ bookmarksScale: 1.8, homeAssistantScale: .7, wolScale: 1.5 });
  const fresh = setup(t, { values, handler: () => Response.json(snapshot({ revision: 8, preferences: remote })) }); await fresh.client.start(); assert.deepEqual(fresh.client.getState().snapshot.preferences, remote);
});

test('old caches gain fullscreen and forecast defaults without writes and confirmed values replace them', async (t) => {
  const keys = ['hideTimeFullscreen', 'hideWeatherFullscreen', 'hideCalendarFullscreen', 'hideHomeAssistantFullscreen', 'hideWolFullscreen', 'weatherHourlyVisible', 'weatherDailyVisible'];
  const preferences = normalizeDashboardPreferences({ hideBookmarksFullscreen: true, mobileWeatherVisible: false });
  const old = { ...preferences }; for (const key of keys) delete old[key];
  const cached = JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: old });
  const values = new Map([[SHARED_SETTINGS_KEY, cached]]);
  const remote = normalizeDashboardPreferences({ hideTimeFullscreen: true, weatherHourlyVisible: false, weatherDailyVisible: false });
  const env = setup(t, { values, handler: () => Response.json(snapshot({ revision: 8, preferences: remote })) });
  assert.equal(env.client.getState().cache, true); assert.deepEqual(env.client.getState().snapshot.preferences, preferences);
  assert.equal(values.get(SHARED_SETTINGS_KEY), cached);
  await env.client.start(); assert.deepEqual(env.client.getState().snapshot.preferences, remote);
  assert.equal(env.calls.length, 1); assert.equal(env.tasks.size, 1);
  assert.deepEqual(JSON.parse(values.get(SHARED_SETTINGS_KEY)).preferences, remote);
  const restored = setup(t, { values }); assert.deepEqual(restored.client.getState().snapshot.preferences, remote);
  const corrupt = setup(t, { values: new Map([[SHARED_SETTINGS_KEY, JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: { ...old, weatherHourlyVisible: 'false' } })]]) });
  assert.equal(corrupt.client.getState().cache, false, 'invalid cached booleans are not upgraded to defaults');
});

test('successful preference confirmation does not depend on cache writes or stale service observers', async (t) => {
  let finish; const env = setup(t, { brokenStorage: true, handler: (_url, options) => options.method === 'PUT' ? new Promise((resolve) => { finish = () => resolve(Response.json(snapshot({ revision: 2, preferences: normalizeDashboardPreferences({ color: '#123456' }) }))); }) : Response.json(snapshot()) });
  await env.client.start(); env.observed.length = 0;
  const save = env.client.save(normalizeDashboardPreferences({ color: '#123456' }), 1); env.epochs.calendar++;
  finish(); await save; assert.equal(env.client.getState().snapshot.revision, 2); assert.equal(env.client.getState().error, ''); assert.equal(env.observed.some((event) => event.name === 'calendar'), false);
});

test('offline write failure cannot publish local-only success and conflicts can update confirmation without rebasing drafts', async (t) => {
  let mode = 'offline'; const env = setup(t, { handler: (_url, options) => {
    if (options.method !== 'PUT') return Response.json(snapshot());
    if (mode === 'offline') throw new Error('offline');
    return Response.json({ error: 'Conflict', snapshot: snapshot({ revision: 3, preferences: normalizeDashboardPreferences({ seconds: false }) }) }, { status: 409 });
  } });
  await env.client.start(); await assert.rejects(env.client.save(normalizeDashboardPreferences({ color: '#123456' }), 1), /offline/); assert.equal(env.client.getState().snapshot.revision, 1);
  mode = 'conflict'; await assert.rejects(env.client.save(normalizeDashboardPreferences({ color: '#123456' }), 1), { status: 409 });
  assert.equal(env.client.getState().snapshot.revision, 3); assert.equal(env.client.getState().snapshot.preferences.color, '#000000'); assert.equal(env.tasks.size, 1);
});

test('old reads cannot replace a committed save, including visibility changes during a write', async (t) => {
  let old; let write; const env = setup(t, { handler: (_url, options) => options.method === 'PUT' ? new Promise((resolve) => { write = () => resolve(Response.json(snapshot({ revision: 2 }))); }) : new Promise((resolve) => { old = () => resolve(Response.json(snapshot())); }) });
  const read = env.client.start(); await settle(); const saved = env.client.save(normalizeDashboardPreferences(), 1); env.client.setVisible(false); write(); await saved;
  old(); await read; await settle(); assert.equal(env.client.getState().snapshot.revision, 2); assert.equal(env.tasks.size, 0);
});

test('per-service metadata deferral leaves preference polling live and discards observations captured during actions', async (t) => {
  let response; let pending = false;
  const env = setup(t, { handler: () => pending ? new Promise((resolve) => { response = () => resolve(Response.json(snapshot({ revision: 2 }))); }) : Response.json(snapshot()) });
  await env.client.start(); env.observed.length = 0;
  const finishCalendar = env.client.beginIntegrationAction('calendar'); const finishBook = env.client.beginIntegrationAction('linkwarden');
  pending = true; env.run(5000); await settle(); finishCalendar(); response(); await settle();
  assert.equal(env.applied.at(-1).revision, 2); assert.equal(env.observed.some((event) => event.name === 'calendar'), false); assert.equal(env.observed.some((event) => event.name === 'weather'), true);
  pending = false; response?.(); await settle(); finishBook(); await settle(); assert.equal(env.tasks.size, 1);
});

test('snapshot guards protect Global read metadata without initializing legacy Local preferences', async (t) => {
  let release;
  const migration = setup(t, { values: new Map([['dashboard.preferences.v1', JSON.stringify({ color: '#123456' })]]), handler: () => new Promise((resolve) => { release = () => resolve(Response.json(snapshot())); }) });
  const loading = migration.client.start(); await settle(); migration.epochs.linkwarden++; release(); await loading;
  assert.equal(migration.client.getState().confirmed, true); assert.equal(migration.observed.some((event) => event.name === 'linkwarden'), false);
});

test('request deadlines release ownership and malformed snapshots retain the last confirmed configuration', async (t) => {
  const timeout = setup(t, { handler: () => new Promise(() => {}) }); const read = timeout.client.start(); timeout.run(10000); await read; assert.equal(timeout.tasks.size, 1); assert.match(timeout.client.getState().error, /timed out/);
  let bad = false; const env = setup(t, { handler: () => Response.json(bad ? { preferences: {} } : snapshot()) }); await env.client.start(); bad = true; await env.client.refresh(); assert.equal(env.client.getState().snapshot.revision, 1); assert.ok(env.client.getState().error);
});

test('old caches gain automatic layout without initialization and nested layouts survive confirmation', async t => {
  const old = normalizeDashboardPreferences({ scale: 1.2 }); delete old.widgetLayout;
  const cached = JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: old });
  const values = new Map([[SHARED_SETTINGS_KEY, cached]]);
  const preferences = normalizeDashboardPreferences({ widgetLayout: { version: 2, desktop: initialWidgetProfile('desktop'), mobile: null } });
  const env = setup(t, { values, handler: (_url, options) => Response.json(snapshot({ revision: options.method === 'PUT' ? 9 : 8, preferences })) });
  assert.deepEqual(env.client.getState().snapshot.preferences.widgetLayout, { version: 2, desktop: null, mobile: null });
  assert.equal(values.get(SHARED_SETTINGS_KEY), cached, 'decoding does not rewrite cache');
  await env.client.start(); assert.deepEqual(env.client.getState().snapshot.preferences.widgetLayout, preferences.widgetLayout);
  await env.client.save(preferences, 8);
  assert.deepEqual(JSON.parse(env.calls.at(-1).options.body).preferences.widgetLayout, preferences.widgetLayout);
  assert.equal(env.calls.some(call => call.url.endsWith('/initialize')), false);
  assert.equal(env.tasks.size, 1, 'layout saves keep the existing single poll owner');
});

test('top-origin cached geometry converts once while offline without cache writes or initialization', async t => {
  const old = { ...normalizeDashboardPreferences(), widgetLayout: { version: 1, desktop: initialWidgetProfile('desktop'), mobile: null } };
  const bytes = JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: old });
  const values = new Map([[SHARED_SETTINGS_KEY, bytes]]);
  const env = setup(t, { values, handler: () => { throw new Error('offline'); } });
  const before = structuredClone(env.client.getState().snapshot.preferences.widgetLayout);
  assert.equal(before.version, 2);
  assert.deepEqual(before.desktop.items, old.widgetLayout.desktop.items.map(item => ({ ...item, y: 1_000_000 - item.y - item.h })));
  await env.client.start(); assert.equal(env.client.getState().confirmed, false);
  assert.deepEqual(env.client.getState().snapshot.preferences.widgetLayout, before);
  assert.equal(values.get(SHARED_SETTINGS_KEY), bytes); assert.equal(env.calls.some(call => call.url.endsWith('/initialize')), false);
});
