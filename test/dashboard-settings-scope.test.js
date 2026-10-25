import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsScope } from '../public/dashboard-settings-scope.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { SCOPE_KEY, LOCAL_SETTINGS_KEY, validateLocalSettings, validateSettingsTransfer, parseSettingsJson } from '../public/dashboard-settings-data.js';
import { slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

const shared = (revision = 1, extra = {}) => ({ initialized: revision > 0, revision, preferences: normalizeDashboardPreferences({ color: '#abcdef' }), integrations: { weather: { available: true, revision: 0, location: null }, calendar: { available: false }, linkwarden: { available: false } }, ...extra });
function setup(t, { values = new Map(), fetchImpl, broken = false } = {}) {
  const calls = []; const applied = []; const clock = slideshowClock();
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { if (broken) throw new Error('quota'); values.set(key, value); }, removeItem: key => values.delete(key) };
  const client = createSettingsScope({ storage, ...clock, onSnapshot: value => applied.push(value), fetchImpl: async (url, options) => { calls.push({ url, options }); return fetchImpl ? fetchImpl(url, options) : Response.json(url === '/api/dashboard/configuration' ? { calendar: { available: false }, linkwarden: { available: false } } : shared()); } });
  t.after(() => client.dispose()); return { client, values, applied, calls, storage, clock };
}

test('Local default ignores shared caches, saves offline, and never initializes or writes shared preferences', async t => {
  const values = new Map([['dashboard.shared-settings.v1', JSON.stringify({ schema: 1, initialized: true, revision: 40, preferences: shared().preferences })]]);
  const env = setup(t, { values, fetchImpl: async () => { throw new Error('offline'); } }); await env.client.start();
  assert.equal(env.client.getState().mode, 'local'); assert.equal(env.client.getState().snapshot.preferences.color, '#000000');
  await env.client.save(normalizeDashboardPreferences({ color: '#123456', timezone: 'Asia/Tokyo' }), env.client.getState().saveToken);
  assert.equal(JSON.parse(values.get(LOCAL_SETTINGS_KEY)).preferences.color, '#123456'); assert.equal(env.calls.every(call => call.url === '/api/dashboard/configuration'), true);
  assert.equal(values.has(SCOPE_KEY), false); const fresh = setup(t, { values }); assert.equal(fresh.client.getState().snapshot.preferences.timezone, 'Asia/Tokyo');
});

test('Local legacy restoration includes location without deleting data on reads or entering Global', async t => {
  const location = { latitude: 51, longitude: 0, label: 'Local city' }; const values = new Map([['dashboard.preferences.v1', JSON.stringify({ color: '#123456', location })]]);
  const env = setup(t, { values }); await env.client.start(); assert.deepEqual(env.client.getState().weatherLocation, location);
  await env.client.changeScope('global'); assert.equal(env.client.getState().snapshot.preferences.color, '#abcdef'); assert.equal(values.has('dashboard.preferences.v1'), true);
  await env.client.changeScope('local'); assert.equal(env.client.getState().snapshot.preferences.color, '#123456');
  env.client.saveLocalLocation({ ...location, label: 'Changed locally' }); assert.equal(values.has('dashboard.preferences.v1'), false);
  assert.equal(env.calls.some(call => call.options.method === 'PUT'), false);
});

test('scope transitions preserve independent records and reject old tokens despite matching numeric revisions', async t => {
  const env = setup(t); await env.client.start(); await env.client.save(normalizeDashboardPreferences({ seconds: false }), env.client.getState().saveToken);
  const local = env.client.getState(); await env.client.changeScope('global'); assert.equal(env.client.getState().snapshot.revision, local.snapshot.revision);
  await assert.rejects(env.client.save(local.snapshot.preferences, local.saveToken), /source or revision/);
  await env.client.changeScope('local'); assert.equal(env.client.getState().snapshot.preferences.seconds, false);
  assert.equal(env.values.get(SCOPE_KEY), JSON.stringify({ schema: 1, mode: 'local' }));
});

test('other profiles remain Global when one browser changes to Local; same-profile storage events follow mode only locally', async t => {
  const a = setup(t); const b = setup(t); const c = setup(t); await Promise.all([a.client.start(), b.client.start(), c.client.start()]);
  await Promise.all([a.client.changeScope('global'), b.client.changeScope('global'), c.client.changeScope('global')]); await a.client.changeScope('local');
  assert.equal(b.client.getState().mode, 'global'); assert.equal(c.client.getState().mode, 'global');
  const tab = setup(t, { values: b.values }); await tab.client.start(); b.values.set(SCOPE_KEY, JSON.stringify({ schema: 1, mode: 'local' })); b.client.storageChanged({ key: SCOPE_KEY }); tab.client.storageChanged({ key: SCOPE_KEY }); await tick();
  assert.equal(tab.client.getState().mode, 'local'); assert.equal(c.client.getState().mode, 'global');
});

test('storage failure cannot publish durable success or change scope; corrupt records remain untouched until explicit save', async t => {
  const broken = setup(t, { broken: true }); await broken.client.start(); const before = broken.client.getState().snapshot;
  await assert.rejects(broken.client.save(normalizeDashboardPreferences({ color: '#123456' }), broken.client.getState().saveToken), /quota/); assert.deepEqual(broken.client.getState().snapshot, before);
  await assert.rejects(broken.client.changeScope('global'), /quota/); assert.equal(broken.client.getState().mode, 'local');
  const values = new Map([[LOCAL_SETTINGS_KEY, '{bad'], [SCOPE_KEY, 'wrong']]); const bad = setup(t, { values }); await bad.client.start(); assert.equal(values.get(LOCAL_SETTINGS_KEY), '{bad');
  await bad.client.save(normalizeDashboardPreferences(), bad.client.getState().saveToken); assert.doesNotThrow(() => validateLocalSettings(JSON.parse(values.get(LOCAL_SETTINGS_KEY))));
});

test('already-changed local records reject stale saves, and pending Global responses cannot apply after a scope event', async t => {
  const env = setup(t); await env.client.start(); const token = env.client.getState().saveToken;
  env.values.set(LOCAL_SETTINGS_KEY, JSON.stringify({ schema: 1, revision: 1, preferences: normalizeDashboardPreferences({ color: '#123456' }), weatherLocation: null }));
  await assert.rejects(env.client.save(normalizeDashboardPreferences(), token), /another tab/); assert.equal(env.client.getState().snapshot.preferences.color, '#123456');
  const work = deferred(); const global = setup(t, { values: new Map([[SCOPE_KEY, JSON.stringify({ schema: 1, mode: 'global' })]]), fetchImpl: url => url === '/api/dashboard/settings' ? work.promise : Response.json({}) });
  const starting = global.client.start(); await tick(); global.values.set(SCOPE_KEY, JSON.stringify({ schema: 1, mode: 'local' })); global.client.storageChanged({ key: SCOPE_KEY });
  work.resolve(Response.json(shared(9))); await starting; await tick(); assert.equal(global.client.getState().mode, 'local'); assert.equal(global.client.getState().snapshot.preferences.color, '#000000');
});

test('dirty drafts and admitted actions block same-tab mode changes without changing stored mode', async t => {
  const env = setup(t); await env.client.start(); await assert.rejects(env.client.changeScope('global', { canChange: false }), /discard/);
  const release = env.client.beginIntegrationAction('weather'); await assert.rejects(env.client.changeScope('global'), /discard/); release();
  assert.equal(env.values.has(SCOPE_KEY), false); await env.client.changeScope('global'); assert.equal(env.client.getState().mode, 'global');
});

test('confirmed import retires an older Global poll rather than coalescing adoption onto the stale read', async t => {
  const old = deferred(); let polls = 0;
  const env = setup(t, { values: new Map([[SCOPE_KEY, JSON.stringify({ schema: 1, mode: 'global' })]]), fetchImpl: async url => {
    if (url.endsWith('/import')) return Response.json({ snapshot: shared(2), weatherRevision: 0 });
    if (url === '/api/dashboard/settings' && ++polls > 1) return old.promise;
    return Response.json(shared());
  } });
  await env.client.start(); await env.clock.advance(5000);
  await env.client.importGlobal({ format: 'home-web.global-settings', version: 1, preferences: shared(2).preferences, weatherLocation: null }, { preferencesRevision: 1, weatherRevision: 0 }, env.client.getState().saveToken);
  assert.equal(env.client.getState().snapshot.revision, 2); old.resolve(Response.json(shared(1))); await tick(); assert.equal(env.client.getState().snapshot.revision, 2);
});

test('pending import rejects competing saves and a late committed result cannot replace a newly selected Local source', async t => {
  const response = deferred(); const env = setup(t, { values: new Map([[SCOPE_KEY, JSON.stringify({ schema: 1, mode: 'global' })]]), fetchImpl: async url => url.endsWith('/import') ? response.promise : Response.json(shared()) });
  await env.client.start(); const token = env.client.getState().saveToken;
  const importing = env.client.importGlobal({ format: 'home-web.global-settings', version: 1, preferences: shared().preferences, weatherLocation: null }, { preferencesRevision: 1, weatherRevision: 0 }, token);
  await assert.rejects(env.client.save(normalizeDashboardPreferences(), token), /import is already pending/); await assert.rejects(env.client.changeScope('local'), /discard/);
  env.values.set(SCOPE_KEY, JSON.stringify({ schema: 1, mode: 'local' })); env.client.storageChanged({ key: SCOPE_KEY });
  response.resolve(Response.json({ snapshot: shared(2), weatherRevision: 0 })); await importing; assert.equal(env.client.getState().mode, 'local'); assert.equal(env.client.getState().snapshot.preferences.color, '#000000'); assert.equal(env.client.getState().pending, false);
});

test('settings transfer and Local record schemas reject unknown fields, invalid locations, oversized UTF-8, and embedded modes', () => {
  const settings = { format: 'home-web.global-settings', version: 1, preferences: normalizeDashboardPreferences(), weatherLocation: null };
  assert.deepEqual(validateSettingsTransfer(settings), settings);
  for (const extra of [{ mode: 'local' }, { password: 'secret' }, { version: 2 }, { weatherLocation: { latitude: 999, longitude: 0, label: 'bad' } }]) assert.throws(() => validateSettingsTransfer({ ...settings, ...extra }));
  assert.throws(() => parseSettingsJson('é'.repeat(65537))); assert.throws(() => validateLocalSettings({ schema: 1, revision: -1, preferences: settings.preferences, weatherLocation: null }));
  const raw = JSON.stringify(settings); assert.deepEqual(parseSettingsJson(raw + ' '.repeat(131072 - Buffer.byteLength(raw))), settings); assert.throws(() => parseSettingsJson(raw + ' '.repeat(131073 - Buffer.byteLength(raw))));
});

test('fresh, legacy and old Local records default to following without read-time migration', async t => {
  const old = { schema: 1, revision: 3, preferences: normalizeDashboardPreferences(), weatherLocation: null };
  for (const values of [new Map(), new Map([['dashboard.preferences.v1', '{"color":"#123456"}']]), new Map([[LOCAL_SETTINGS_KEY, JSON.stringify(old)]])]) {
    const before = [...values]; const env = setup(t, { values }); await env.client.start();
    assert.equal(env.client.getState().followGlobalPhotos, true); assert.deepEqual([...values], before);
  }
  assert.equal(validateLocalSettings({ ...old, followGlobalPhotos: false }).followGlobalPhotos, false);
  for (const invalid of [null, 'false', 0, undefined]) assert.throws(() => validateLocalSettings({ ...old, followGlobalPhotos: invalid }), /Invalid local settings/);
  assert.throws(() => validateLocalSettings({ ...old, followGlobalPhotos: true, extra: true }), /Invalid local settings/);
});

test('photo option and preferences save atomically and survive unrelated saves and scope round trips', async t => {
  const env = setup(t); await env.client.start(); const token = env.client.getState().saveToken;
  const preferences = normalizeDashboardPreferences({ order: 'date', interval: 17, timezone: 'Asia/Tokyo' });
  await env.client.save(preferences, token, { followGlobalPhotos: false });
  const record = JSON.parse(env.values.get(LOCAL_SETTINGS_KEY)); assert.equal(record.revision, 1); assert.equal(record.followGlobalPhotos, false); assert.deepEqual(record.preferences, preferences);
  await assert.rejects(env.client.save(preferences, token, { followGlobalPhotos: true }), /source or revision/);
  env.client.saveLocalLocation({ latitude: 35, longitude: 139, label: 'Tokyo' });
  await env.client.save({ ...preferences, scale: 1.2 }, env.client.getState().saveToken);
  assert.equal(env.client.getState().followGlobalPhotos, false);
  await env.client.changeScope('global'); const count = env.calls.length;
  await assert.rejects(env.client.save(preferences, env.client.getState().saveToken, { followGlobalPhotos: true }), /Local scope/);
  assert.equal(env.calls.length, count);
  await env.client.changeScope('local'); await env.client.refresh();
  assert.equal(env.client.getState().followGlobalPhotos, false); assert.equal(env.client.getState().weatherLocation.label, 'Tokyo');
  const fresh = setup(t, { values: env.values }); assert.equal(fresh.client.getState().followGlobalPhotos, false);
  await env.client.save(preferences, env.client.getState().saveToken, { followGlobalPhotos: true });
  await env.client.changeScope('global'); await env.client.changeScope('local'); assert.equal(env.client.getState().followGlobalPhotos, true);
  assert.equal(env.calls.some(call => call.options.method === 'PUT'), false);
});

test('photo option storage events remain profile-local and reject competing stale saves', async t => {
  const a = setup(t); const tab = setup(t, { values: a.values }); const other = setup(t);
  await Promise.all([a.client.start(), tab.client.start(), other.client.start()]);
  const preferences = normalizeDashboardPreferences(); const stale = tab.client.getState().saveToken;
  await a.client.save(preferences, a.client.getState().saveToken, { followGlobalPhotos: false });
  await assert.rejects(tab.client.save(preferences, stale, { followGlobalPhotos: true }), /another tab/);
  tab.client.storageChanged({ key: LOCAL_SETTINGS_KEY }); assert.equal(tab.client.getState().followGlobalPhotos, false); assert.equal(other.client.getState().followGlobalPhotos, true);
  await a.client.save(preferences, a.client.getState().saveToken, { followGlobalPhotos: true });
  tab.client.storageChanged({ key: LOCAL_SETTINGS_KEY }); assert.equal(tab.client.getState().followGlobalPhotos, true);
});

test('invalid or failed photo option saves leave confirmed preferences and storage untouched', async t => {
  const env = setup(t, { broken: true }); await env.client.start(); const before = env.client.getState();
  await assert.rejects(env.client.save(normalizeDashboardPreferences({ color: '#123456' }), before.saveToken, { followGlobalPhotos: false }), /quota/);
  assert.deepEqual(env.client.getState(), before); assert.equal(env.values.has(LOCAL_SETTINGS_KEY), false);
  const valid = setup(t); await valid.client.start();
  await assert.rejects(valid.client.save(normalizeDashboardPreferences(), valid.client.getState().saveToken, { followGlobalPhotos: 'false' }), /boolean/);
  assert.equal(valid.values.has(LOCAL_SETTINGS_KEY), false);
});
