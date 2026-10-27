import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createSettingsTransfer } from '../src/dashboard-settings-transfer.js';
import { createDashboardPreferenceStore } from '../src/dashboard-preferences.js';
import { createWeatherStore } from '../src/weather-store.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';

const bundle = (extra = {}) => ({ format: 'home-web.global-settings', version: 1, preferences: normalizeDashboardPreferences({ color: '#123456' }), weatherLocation: { latitude: 51, longitude: 0, label: 'London' }, ...extra });

test('old transfers default absent image visibility and current exports retain explicit false and true', () => {
  const store = createStore(':memory:');
  try {
    const old = bundle(); delete old.preferences.imageVisible;
    store.importDashboardSettings(old, 0, 0); assert.deepEqual(store.exportDashboardSettings().settings, bundle());
    for (const imageVisible of [false, true]) {
      const current = store.exportDashboardSettings(); const settings = bundle({ preferences: { ...current.settings.preferences, imageVisible } });
      store.importDashboardSettings(settings, current.preferencesRevision, current.weatherRevision);
      assert.deepEqual(store.exportDashboardSettings().settings, settings);
    }
    const before = store.exportDashboardSettings();
    for (const imageVisible of [null, 'false', 0]) assert.throws(() => store.importDashboardSettings({ ...old, preferences: { ...old.preferences, imageVisible } }, before.preferencesRevision, before.weatherRevision));
    assert.deepEqual(store.exportDashboardSettings(), before);
  } finally { store.close(); }
});

test('previous complete transfers default absent widget scales and export all explicit scale values', () => {
  const store = createStore(':memory:');
  try {
    const old = bundle(); const keys = ['bookmarksScale', 'mobileBookmarksScale', 'homeAssistantScale', 'mobileHomeAssistantScale', 'wolScale', 'mobileWolScale']; for (const key of keys) delete old.preferences[key];
    store.importDashboardSettings(old, 0, 0); assert.deepEqual(store.exportDashboardSettings().settings, bundle());
    const next = bundle({ preferences: normalizeDashboardPreferences(Object.fromEntries(keys.map((key, i) => [key, .5 + i / 10]))) });
    const current = store.exportDashboardSettings(); store.importDashboardSettings(next, current.preferencesRevision, current.weatherRevision); assert.deepEqual(store.exportDashboardSettings().settings, next);
    for (const key of keys) assert.throws(() => store.importDashboardSettings({ ...old, preferences: { ...old.preferences, [key]: '1' } }, 2, 1));
    assert.deepEqual(store.exportDashboardSettings().settings, next);
  } finally { store.close(); }
});

test('global settings import is one revision-checked transaction; export is read-only and no-op/clear round trips work', () => {
  const store = createStore(':memory:');
  try {
    const initial = store.exportDashboardSettings(); assert.equal(store.getDashboardPreferences().initialized, false); assert.equal(initial.weatherRevision, 0);
    const saved = store.importDashboardSettings(bundle(), 0, 0); assert.equal(saved.preferencesRevision, 1); assert.equal(saved.weatherRevision, 1);
    assert.deepEqual(store.exportDashboardSettings().settings, bundle()); assert.equal(store.importDashboardSettings(bundle(), 0, 1), null); assert.equal(store.importDashboardSettings(bundle(), 1, 0), null);
    const unchanged = store.importDashboardSettings(bundle(), 1, 1); assert.equal(unchanged.preferencesRevision, 1); assert.equal(unchanged.weatherRevision, 1);
    const cleared = store.importDashboardSettings(bundle({ weatherLocation: null }), 1, 1); assert.equal(cleared.weatherRevision, 2); assert.equal(store.getWeatherLocation().location, null);
    assert.equal(JSON.stringify(cleared.settings).includes('mode'), false);
  } finally { store.close(); }
});

test('failure between imported component writes rolls back preferences and weather, including initialization', () => {
  const db = new DatabaseSync(':memory:'); const preferences = createDashboardPreferenceStore(db); const weather = createWeatherStore(db);
  const transfer = createSettingsTransfer(db, preferences, { ...weather, saveWeatherLocation() { throw new Error('fixture write failure'); } });
  assert.throws(() => transfer.importDashboardSettings(bundle(), 0, 0), /fixture/); assert.equal(preferences.getDashboardPreferences().initialized, false); assert.equal(weather.getWeatherLocation().revision, 0); assert.equal(db.isTransaction, false); db.close();
});

test('maximum canonical selection sets fit the transfer contract and survive import without substituting identities', () => {
  const store = createStore(':memory:');
  try {
    const ids = Array.from({ length: 256 }, (_, i) => String(i).padStart(43, '0'));
    const preferences = normalizeDashboardPreferences({ homeAssistantDeviceSelections: ids.map(id => `d_${id}`), bookmarkLinkSelections: ids.map(id => ({ selectionId: `b_${id}`, collectionSelectionId: id })) });
    const settings = bundle({ preferences }); assert.ok(Buffer.byteLength(JSON.stringify(settings)) < 131072);
    store.importDashboardSettings(settings, 0, 0); assert.deepEqual(store.exportDashboardSettings().settings, settings);
  } finally { store.close(); }
});

test('transfer API protects methods/validation/conflicts and notification failures cannot undo committed imports', async t => {
  const store = createStore(':memory:'); const server = createDashboardServer({ store, runtimeConfig: { allowedHosts: ['127.0.0.1'] }, slideshow: { configure() { throw new Error('fixture'); } }, weather: { reloadLocation() { throw new Error('fixture'); } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { await server.lifecycle.shutdown(); store.close(); }); const base = `http://127.0.0.1:${server.address().port}`;
  const send = data => fetch(`${base}/api/dashboard/settings/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const exported = await fetch(`${base}/api/dashboard/settings/export`); assert.match(exported.headers.get('content-disposition'), /attachment/); assert.equal(exported.headers.get('cache-control'), 'no-store'); assert.equal((await exported.json()).weatherLocation, null);
  const input = { settings: bundle(), preferencesRevision: 0, weatherRevision: 0 }; assert.equal((await send(input)).status, 200); assert.equal(store.getDashboardPreferences().revision, 1); assert.equal(store.getWeatherLocation().revision, 1);
  assert.equal((await send(input)).status, 409); assert.equal((await send({ ...input, settings: { ...bundle(), scope: 'local' } })).status, 400);
  assert.equal((await fetch(`${base}/api/dashboard/settings/export`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/dashboard/settings/import`, { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' })).status, 403);
});
