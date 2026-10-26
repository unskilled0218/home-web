import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsScope } from '../public/dashboard-settings-scope.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { CATEGORY_SCOPES_KEY, SCOPE_KEY, LOCAL_SETTINGS_KEY, validateLocalSettings, validateSettingsTransfer, parseSettingsJson } from '../public/dashboard-settings-data.js';
import { CATEGORY_IDS, categoryScopes, categoryPreferences } from '../public/dashboard-settings-categories.js';
import { slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';
import { defaultWidgetLayout, initialWidgetProfile } from '../public/dashboard-layout.js';
import { createLayoutSession } from '../public/dashboard-layout-session.js';

const shared = (revision = 1, extra = {}) => ({ initialized: revision > 0, revision, preferences: normalizeDashboardPreferences({ color: '#abcdef', timezone: 'Europe/London' }), integrations: { weather: { available: true, revision: 0, location: null }, calendar: { available: false }, linkwarden: { available: false } }, ...extra });
const mapRecord = (scopes = categoryScopes(), revision = 1) => JSON.stringify({ schema: 1, revision, scopes });
function setup(t, { values = new Map(), fetchImpl, broken = false, initialSnapshot = shared() } = {}) {
  const calls = []; const applied = []; const clock = slideshowClock(); let snapshot = initialSnapshot;
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { if (broken) throw new Error('quota'); values.set(key, value); }, removeItem: key => values.delete(key) };
  const client = createSettingsScope({ storage, ...clock, onSnapshot: value => applied.push(value), fetchImpl: async (url, options = {}) => {
    calls.push({ url, options }); if (fetchImpl) return fetchImpl(url, options);
    if (url === '/api/dashboard/configuration') return Response.json({ calendar: { available: false }, linkwarden: { available: false } });
    if (options.method === 'PUT') { const body = JSON.parse(options.body); snapshot = shared(snapshot.revision + 1, { preferences: body.preferences }); }
    return Response.json(snapshot);
  } });
  t.after(() => client.dispose()); return { client, values, applied, calls, storage, clock, writes: () => calls.filter(call => call.options.method && call.options.method !== 'GET') };
}
const save = (env, id, patch, options) => env.client.saveCategory(id, patch, env.client.getCategoryState(id).saveToken, options);

for (const mode of ['local', 'global']) test(`${mode} saves preserve absent General controls and layout saves patch only geometry`, async t => {
  const widgetLayout = { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop', 'right'), mobile: initialWidgetProfile('mobile') };
  const preferences = normalizeDashboardPreferences({ position: 'right', scale: 1.7, widgetLayout, color: '#123456' });
  const values = new Map([[CATEGORY_SCOPES_KEY, mapRecord({ ...categoryScopes(mode), weather: mode === 'local' ? 'global' : 'local' })], [LOCAL_SETTINGS_KEY, JSON.stringify({ schema: 1, revision: 3, preferences, weatherLocation: null, followGlobalPhotos: false })]]);
  const env = setup(t, { values, initialSnapshot: shared(4, { preferences: { ...preferences, color: '#abcdef' } }) }); await env.client.start();
  const raw = () => mode === 'local' ? JSON.parse(values.get(LOCAL_SETTINGS_KEY)).preferences : env.client.getTransferState().snapshot.preferences;
  const before = structuredClone(raw());
  await env.client.refresh(); await save(env, 'general', categoryPreferences('general', env.client.getCategoryState('general').snapshot.preferences));
  assert.deepEqual(raw(), before, 'General without editable inputs preserves its captured baseline');
  await save(env, 'time', { seconds: false });
  assert.deepEqual(raw(), { ...before, seconds: false }, 'another category cannot reset retained General values');
  const category = env.client.getCategoryState('general'); const session = createLayoutSession(); session.load(category, 'desktop'); session.layer('front', session.draft.desktop.items[0].id);
  const payload = session.payload(); assert.deepEqual(Object.keys(payload.preferences), ['widgetLayout']);
  await env.client.saveCategory('general', payload.preferences, payload.revision);
  assert.deepEqual(raw(), { ...before, seconds: false, widgetLayout: payload.preferences.widgetLayout });
  assert.deepEqual(raw().widgetLayout.mobile, before.widgetLayout.mobile);
});

test('fresh, legacy Local and legacy Global scope records seed all categories without migration writes', async t => {
  for (const mode of [null, 'local', 'global']) {
    const values = new Map(mode ? [[SCOPE_KEY, JSON.stringify({ schema: 1, mode })]] : []); const before = [...values]; const env = setup(t, { values });
    assert.deepEqual(env.client.getState().scopes, categoryScopes(mode ?? 'local')); assert.deepEqual([...values], before);
    await env.client.start(); assert.equal(values.has(CATEGORY_SCOPES_KEY), false); assert.equal(env.writes().length, 0);
  }
});

test('metadata discovery fills only Local installation readers and does not duplicate all-Global discovery', async t => {
  const allGlobal = setup(t, { values: new Map([[CATEGORY_SCOPES_KEY, mapRecord(categoryScopes('global'))]]) }); await allGlobal.client.start();
  assert.equal(allGlobal.calls.some(call => call.url === '/api/dashboard/configuration'), false);
  const local = setup(t); await local.client.start();
  assert.equal(local.calls.some(call => call.url === '/api/dashboard/configuration'), true);
  assert.equal(local.calls.some(call => call.url === '/api/dashboard/settings'), false);
});

test('mixed scopes project each raw store and saves never publish another category or Local values', async t => {
  const env = setup(t); await env.client.start(); await save(env, 'images', { color: '#123456' }, { followGlobalPhotos: false });
  await env.client.changeScope('time', 'global'); const before = env.client.getTransferState().snapshot.preferences;
  assert.equal(env.client.getState().snapshot.preferences.color, '#123456'); assert.equal(env.client.getState().snapshot.preferences.timezone, 'Europe/London');
  await save(env, 'time', { timezone: 'Asia/Tokyo' });
  const sent = JSON.parse(env.writes()[0].options.body).preferences; assert.equal(sent.timezone, 'Asia/Tokyo'); assert.equal(sent.color, before.color);
  await save(env, 'weather', { temperature: 'fahrenheit' }); assert.equal(env.writes().length, 1);
  await env.client.changeScope('images', 'global'); await env.client.changeScope('images', 'local');
  assert.equal(env.client.getState().followGlobalPhotos, false); assert.equal(env.client.getState().snapshot.preferences.color, '#123456');
  const fresh = setup(t, { values: env.values }); assert.equal(fresh.client.getState().scopes.time, 'global'); assert.equal(fresh.client.getState().scopes.weather, 'local');
});

test('every category saves an allowlisted patch and rejects foreign keys without side effects', async t => {
  for (const id of CATEGORY_IDS) {
    const env = setup(t); await env.client.start(); const preferences = normalizeDashboardPreferences({ color: '#123456', timezone: 'Asia/Tokyo', scale: 1.5 });
    await save(env, id, categoryPreferences(id, preferences));
    const saved = JSON.parse(env.values.get(LOCAL_SETTINGS_KEY)); assert.deepEqual(categoryPreferences(id, saved.preferences), categoryPreferences(id, preferences));
    const other = CATEGORY_IDS.find(other => other !== id); const before = [...env.values];
    await assert.rejects(save(env, id, categoryPreferences(other, preferences)), /category preference/); assert.deepEqual([...env.values], before);
  }
});

test('every Global category preserves nonowned raw values rather than the mixed projection', async t => {
  for (const id of CATEGORY_IDS) {
    const values = new Map([[CATEGORY_SCOPES_KEY, mapRecord({ ...categoryScopes(), [id]: 'global' })], [LOCAL_SETTINGS_KEY, JSON.stringify({ schema: 1, revision: 1, preferences: normalizeDashboardPreferences({ color: '#123456', timezone: 'Asia/Tokyo', scale: 1.8 }), weatherLocation: null, followGlobalPhotos: false })]]);
    const env = setup(t, { values }); await env.client.start(); const before = env.client.getTransferState().snapshot.preferences;
    const patch = categoryPreferences(id, normalizeDashboardPreferences({ color: '#654321', timezone: 'America/New_York', scale: 1.2 }));
    await save(env, id, patch); const sent = JSON.parse(env.writes()[0].options.body).preferences;
    assert.deepEqual(categoryPreferences(id, sent), patch);
    for (const other of CATEGORY_IDS.filter(other => other !== id)) assert.deepEqual(categoryPreferences(other, sent), categoryPreferences(other, before));
    assert.equal(JSON.parse(values.get(LOCAL_SETTINGS_KEY)).revision, 1); assert.equal(env.client.getState().followGlobalPhotos, false);
  }
});

test('same-store saves stale dirty tokens but unrelated scope-only changes preserve valid category tokens', async t => {
  const env = setup(t); await env.client.start(); const token = env.client.getCategoryState('time').saveToken;
  const source = env.client.getCategoryState('time').source; await env.client.changeScope('weather', 'global');
  assert.equal(env.client.getCategoryState('time').source, source); await env.client.saveCategory('time', { seconds: false }, token);
  await assert.rejects(env.client.saveCategory('time', { seconds: true }, token), /revision changed/);
  const local = env.client.getCategoryState('time'); await env.client.changeScope('time', 'global'); await env.client.changeScope('time', 'local');
  await assert.rejects(env.client.saveCategory('time', {}, local.saveToken), /source or revision changed/);
});

for (const [name, category, globalOnly] of [['local save', 'time', false], ['global save', 'time', true], ['layout', 'general', false], ['weather location', 'weather', false], ['calendar', 'calendar', true], ['linkwarden', 'bookmarks', true], ['home-assistant', 'home-assistant', true], ['wol', 'wol', true], ['import', 'general', true]]) test(`${name} rejects persisted scope changes before delayed storage events`, async t => {
  const initial = categoryScopes(globalOnly ? 'global' : 'local'); const values = new Map([[CATEGORY_SCOPES_KEY, mapRecord(initial)]]); const env = setup(t, { values }); await env.client.start();
  const token = env.client.getCategoryState(category).saveToken; const before = env.writes().length;
  values.set(CATEGORY_SCOPES_KEY, mapRecord({ ...initial, [category]: globalOnly ? 'local' : 'global' }, 2));
  if (name.includes('save') || name === 'layout') await assert.rejects(env.client.saveCategory(category, {}, token), /source or revision changed/);
  else if (name === 'weather location') assert.throws(() => env.client.saveLocalLocation(null, token), /source or revision changed/);
  else if (name === 'import') await assert.rejects(env.client.importGlobal({ format: 'home-web.global-settings', version: 1, preferences: shared().preferences, weatherLocation: null }, { preferencesRevision: 1, weatherRevision: 0 }, token), /source or revision changed/);
  else assert.throws(() => env.client.beginIntegrationAction(name, token), /source or revision changed/);
  assert.equal(env.writes().length, before); assert.equal(values.has(LOCAL_SETTINGS_KEY), false);
});

test('admission reconciles unrelated maps, rejects unreadable storage, and rechecks awaited preflight', async t => {
  const values = new Map([[CATEGORY_SCOPES_KEY, mapRecord(categoryScopes('global'))]]); const env = setup(t, { values }); await env.client.start();
  const token = env.client.getCategoryState('calendar').saveToken;
  values.set(CATEGORY_SCOPES_KEY, mapRecord({ ...categoryScopes('global'), weather: 'local' }, 2));
  const release = env.client.beginIntegrationAction('calendar', token); await tick();
  values.set(CATEGORY_SCOPES_KEY, mapRecord({ ...categoryScopes('global'), weather: 'local', calendar: 'local' }, 3));
  assert.throws(() => release.check(), /source or revision changed/); release();
  env.storage.getItem = () => { throw Error('blocked'); };
  assert.throws(() => env.client.admitMutation('time', env.client.getCategoryState('time').saveToken), /could not be read/);
});

test('legacy Local values, weather location and image-follow choice survive unrelated writes', async t => {
  const values = new Map([['dashboard.preferences.v1', JSON.stringify({ color: '#123456', location: { latitude: 35, longitude: 139, label: 'Tokyo' } })]]); const env = setup(t, { values }); await env.client.start();
  assert.equal(env.client.getState().weatherLocation.label, 'Tokyo'); assert.equal(env.client.getState().followGlobalPhotos, true);
  await save(env, 'images', {}, { followGlobalPhotos: false }); await save(env, 'general', { scale: 1.5 });
  env.client.saveLocalLocation({ latitude: 0, longitude: 0, label: 'Other city' }, env.client.getCategoryState('weather').saveToken);
  const fresh = setup(t, { values }); assert.equal(fresh.client.getState().followGlobalPhotos, false); assert.equal(fresh.client.getState().weatherLocation.label, 'Other city');
  assert.equal(fresh.client.getState().snapshot.preferences.color, '#123456'); assert.equal(values.has('dashboard.preferences.v1'), false);
  await assert.rejects(save(env, 'time', {}, { followGlobalPhotos: true }), /Local Images/);
});

test('Local categories save offline and during unrelated Global work without receiving its late values', async t => {
  const pending = deferred(); const env = setup(t, { fetchImpl: url => url === '/api/dashboard/settings' ? pending.promise : Response.json({ calendar: { available: false }, linkwarden: { available: false } }) });
  await env.client.start(); const changing = env.client.changeScope('time', 'global'); await tick();
  await save(env, 'weather', { temperature: 'fahrenheit' }); await save(env, 'images', { color: '#123456' });
  await env.client.changeScope('time', 'local'); pending.resolve(Response.json(shared())); await changing; await tick();
  assert.equal(env.client.getState().snapshot.preferences.timezone, 'UTC'); assert.equal(env.client.getState().snapshot.preferences.color, '#123456'); assert.equal(env.client.getState().snapshot.preferences.temperature, 'fahrenheit');
  assert.equal(env.writes().length, 0);
});

test('same-profile map events leave independent profiles unchanged and storage failures preserve confirmed state', async t => {
  const a = setup(t); const tab = setup(t, { values: a.values }); const other = setup(t); await a.client.start(); await tab.client.start();
  await a.client.changeScope('time', 'global'); tab.client.storageChanged({ key: CATEGORY_SCOPES_KEY }); await tick();
  assert.equal(tab.client.getState().scopes.time, 'global'); assert.equal(other.client.getState().scopes.time, 'local');
  const broken = setup(t, { broken: true }); await broken.client.start(); const before = broken.client.getState();
  await assert.rejects(broken.client.changeScope('time', 'global'), /quota/); await assert.rejects(save(broken, 'time', { seconds: false }), /quota/); assert.deepEqual(broken.client.getState(), before);
  await assert.rejects(a.client.changeScope('time', 'local', { canChange: false }), /discard/);
});

test('corrupt scope maps block ordinary mutations until confirmed map-only recovery', async t => {
  const local = { schema: 1, revision: 4, preferences: normalizeDashboardPreferences({ color: '#123456' }), weatherLocation: null, followGlobalPhotos: false };
  const values = new Map([[CATEGORY_SCOPES_KEY, '{bad'], [LOCAL_SETTINGS_KEY, JSON.stringify(local)], [SCOPE_KEY, JSON.stringify({ schema: 1, mode: 'global' })]]); const env = setup(t, { values }); await env.client.start(); const before = [...values];
  assert.equal(env.client.getState().scopeError.length > 0, true); await assert.rejects(save(env, 'time', { seconds: false }), /could not be read/); assert.deepEqual([...values], before);
  assert.equal(await env.client.resetScopes(() => false), false); assert.deepEqual([...values], before);
  const stale = env.client.getCategoryState('time').saveToken;
  assert.equal(await env.client.resetScopes(() => true), true); assert.deepEqual(env.client.getState().scopes, categoryScopes());
  assert.equal(values.get(LOCAL_SETTINGS_KEY), JSON.stringify(local)); assert.equal(values.get(SCOPE_KEY), before[2][1]);
  await assert.rejects(env.client.saveCategory('time', {}, stale), /source or revision changed/);
  await save(env, 'time', { seconds: false }); assert.equal(env.client.getState().followGlobalPhotos, false);
});

test('corruption retains a confirmed mixed map for preview and rejects a concurrent corrupt replacement', async t => {
  const mixed = { ...categoryScopes(), time: 'global' }; const values = new Map([[CATEGORY_SCOPES_KEY, mapRecord(mixed)]]);
  const env = setup(t, { values }); await env.client.start(); values.set(CATEGORY_SCOPES_KEY, '{bad'); await env.client.refresh();
  assert.deepEqual(env.client.getState().scopes, mixed); assert.equal(env.client.getState().snapshot.preferences.timezone, 'Europe/London');
  const before = env.writes().length; await assert.rejects(save(env, 'time', { seconds: false }), /could not be read/); assert.equal(env.writes().length, before);
  await assert.rejects(env.client.resetScopes(() => { values.set(CATEGORY_SCOPES_KEY, '{different bad'); return true; }), /changed during recovery/);
  assert.equal(values.get(CATEGORY_SCOPES_KEY), '{different bad'); assert.deepEqual(env.client.getState().scopes, mixed);
});

test('recovery does not overwrite concurrent repair or claim successful persistence on failure', async t => {
  const values = new Map([[CATEGORY_SCOPES_KEY, '{bad']]); const env = setup(t, { values }); await env.client.start();
  await assert.rejects(env.client.resetScopes(() => { values.set(CATEGORY_SCOPES_KEY, mapRecord({ ...categoryScopes(), time: 'global' })); return true; }), /changed during recovery/);
  assert.equal(env.client.getState().scopes.time, 'global'); values.set(CATEGORY_SCOPES_KEY, '{bad'); env.client.storageChanged({ key: CATEGORY_SCOPES_KEY }); await tick();
  env.storage.setItem = () => { throw Error('quota'); }; await assert.rejects(env.client.resetScopes(() => true), /quota/); assert.equal(values.get(CATEGORY_SCOPES_KEY), '{bad');
});

test('whole Global imports use raw revisions, preserve Local values, and reject concurrent writes', async t => {
  const result = deferred(); const values = new Map([[CATEGORY_SCOPES_KEY, mapRecord({ ...categoryScopes(), general: 'global' })]]);
  const env = setup(t, { values, fetchImpl: url => url.endsWith('/import') ? result.promise : Response.json(url === '/api/dashboard/configuration' ? { calendar: { available: false }, linkwarden: { available: false } } : shared()) }); await env.client.start();
  await save(env, 'images', { color: '#123456' }, { followGlobalPhotos: false }); const raw = values.get(LOCAL_SETTINGS_KEY); const token = env.client.getTransferState().saveToken;
  const importing = env.client.importGlobal({ format: 'home-web.global-settings', version: 1, preferences: shared().preferences, weatherLocation: null }, { preferencesRevision: 1, weatherRevision: 0 }, token);
  await assert.rejects(save(env, 'general', { scale: 1.5 }), /pending/); await save(env, 'time', { seconds: false });
  result.resolve(Response.json({ snapshot: shared(2), weatherRevision: 1 })); await importing;
  assert.equal(env.client.getState().snapshot.preferences.color, '#123456'); assert.equal(env.client.getState().followGlobalPhotos, false);
  assert.equal(JSON.parse(raw).preferences.color, JSON.parse(values.get(LOCAL_SETTINGS_KEY)).preferences.color); assert.equal(env.client.getTransferState().snapshot.revision, 2);
});

test('Local and transfer schemas remain strict and bounded', () => {
  const preferences = normalizeDashboardPreferences(); const bundle = { format: 'home-web.global-settings', version: 1, preferences, weatherLocation: null };
  assert.deepEqual(validateSettingsTransfer(bundle), bundle); assert.throws(() => validateSettingsTransfer({ ...bundle, scopes: categoryScopes() }));
  const old = { schema: 1, revision: 0, preferences, weatherLocation: null }; assert.equal(validateLocalSettings(old).followGlobalPhotos, true);
  for (const followGlobalPhotos of [null, 'false', 0, undefined]) assert.throws(() => validateLocalSettings({ ...old, followGlobalPhotos }));
  assert.throws(() => parseSettingsJson('é'.repeat(65537)));
});
