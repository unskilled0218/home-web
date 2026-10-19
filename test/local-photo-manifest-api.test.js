import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createPhotoLibrary } from '../src/photo-library.js';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { validateLocalPhotoManifest } from '../public/photo-slideshow-data.js';
import { createLocalPhotoController } from '../public/dashboard-local-photos.js';
import { createScopedPhotoController } from '../public/dashboard-photo-scope.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { photo, slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

test('Local producer filters oversized legacy metadata before serialization and does not change Global selection', async t => {
  const root = await mkdtemp('/tmp/opencode/local-photo-api-'); const directory = path.join(root, ...Array(8).fill('\u0001'.repeat(100))); await mkdir(directory, { recursive: true });
  await writeFile(path.join(root, 'valid.png'), 'image'); for (let i = 0; i < 99; i++) await writeFile(path.join(directory, `${i}.png`), 'image');
  const library = createPhotoLibrary({ root }); const clock = slideshowClock(); const slideshow = createPhotoSlideshow({ ...clock, photoLibrary: library, preferences: { order: 'name', interval: 5 } }); await slideshow.start(); const store = createStore(':memory:');
  const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store, photoLibrary: library, photoSourceEnabled: true, slideshow }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await Promise.all([slideshow.stop(), server.lifecycle.shutdown()]); store.close(); await rm(root, { recursive: true, force: true }); }); const base = `http://127.0.0.1:${server.address().port}`;
  const legacy = await (await fetch(`${base}/api/dashboard/photos`)).text(); assert.ok(Buffer.byteLength(legacy) > 262144); assert.equal(JSON.parse(legacy).photos.length, 100);
  const before = slideshow.snapshot(); const response = await fetch(`${base}/api/dashboard/photos/local`); const body = await response.text(); const manifest = validateLocalPhotoManifest(JSON.parse(body)); assert.ok(Buffer.byteLength(body) <= 262144); assert.equal(manifest.count, 1); assert.equal(manifest.photos[0].name, 'valid.png'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(slideshow.snapshot(), before);
  assert.equal((await fetch(base + manifest.photos[0].url)).status, 200); await rm(path.join(root, 'valid.png')); await library.refresh(); const empty = validateLocalPhotoManifest(await (await fetch(`${base}/api/dashboard/photos/local`)).json()); assert.equal(empty.available, true); assert.equal(empty.count, 0);
  assert.equal((await fetch(`${base}/api/dashboard/photos/local`, { method: 'POST' })).status, 405);
});

test('disabled projection never scans, while failed enabled preparation remains unavailable rather than disabled', async t => {
  for (const enabled of [false, true]) {
    let scans = 0; const store = createStore(':memory:'); const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store, photoSourceEnabled: enabled, photoLibrary: { async local() { scans++; return { available: false, photos: [] }; } } }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await server.lifecycle.shutdown(); store.close(); }); const state = validateLocalPhotoManifest(await (await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/photos/local`)).json()); assert.equal(state.enabled, enabled); assert.equal(state.available, false); assert.equal(scans, enabled ? 1 : 0);
  }
});

test('Local player owns ordering/interval, retains outage state, clears confirmed empty/disabled and retires hidden work', async () => {
  const clock = slideshowClock(); const shown = []; let clears = 0; let reads = 0; let manifest = { version: 1, enabled: true, available: true, count: 2, photos: [photo(), photo('b.png')] };
  const client = createLocalPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel, clear: () => { clears++; }, show: row => shown.push(row.file.name), report() {}, decode: async () => {}, fetchImpl: async url => { assert.equal(url, '/api/dashboard/photos/local'); reads++; return Response.json(manifest); } });
  client.configure(normalizeDashboardPreferences({ order: 'name', interval: 5 })); await client.load(); await tick(); assert.deepEqual(shown, ['a.png']);
  await clock.advance(5000); assert.deepEqual(shown, ['a.png', 'b.png']); assert.equal(reads, 1);
  manifest = { version: 1, enabled: true, available: false, count: 0, photos: [] }; await client.load(); await tick(); assert.equal(clears, 0);
  manifest = { ...manifest, available: true }; await client.load(); await tick(); assert.ok(clears > 0);
  client.setVisible(false); await tick(); assert.equal(clock.timers.size, 0); client.setVisible(true); await tick(); client.dispose(); await tick(); assert.equal(clock.timers.size, 0);
});

test('Local manifest validator bounds eligible names/records and rejects incompatible source flags', () => {
  const photos = Array.from({ length: 100 }, (_, i) => photo(`${'"'.repeat(1000)}${i}.png`));
  const value = { version: 1, enabled: true, available: true, count: 100, photos }; assert.doesNotThrow(() => validateLocalPhotoManifest(value)); assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 262144);
  for (const extra of [{ version: 2 }, { count: 99 }, { enabled: false }, { available: false }, { extra: true }, { photos: [...photos, photo()], count: 101 }]) assert.throws(() => validateLocalPhotoManifest({ ...value, ...extra }));
});

test('Local first-load image failure retries the same single photo within five seconds without rescanning', async () => {
  const clock = slideshowClock(); const shown = []; const urls = []; let reads = 0;
  const manifest = { version: 1, enabled: true, available: true, count: 1, photos: [photo()] };
  const client = createLocalPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel, clear() {}, report() {}, show: row => shown.push(row.url), decode: async url => { urls.push(url); if (urls.length === 1) throw new Error('Temporary image failure.'); }, fetchImpl: async () => { reads++; return Response.json(manifest); } });
  try {
    client.configure(normalizeDashboardPreferences()); await client.load(); await tick();
    assert.deepEqual(shown, []); assert.deepEqual(urls, [photo().url]);
    await clock.advance(5000);
    assert.deepEqual(shown, [photo().url]); assert.deepEqual(urls, [photo().url, photo().url]); assert.equal(reads, 1);
  } finally { client.dispose(); await tick(); }
  assert.equal(clock.timers.size, 0);
});

test('Local image retries stop while hidden and on disposal, and late decode cannot render', async () => {
  const clock = slideshowClock(); const shown = []; const pending = deferred(); let attempts = 0; let signal;
  const client = createLocalPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel, clear() {}, report() {}, show: row => shown.push(row.url), decode: async (_url, options) => { attempts++; signal = options.signal; if (attempts === 1) throw new Error('Temporary image failure.'); return pending.promise; }, fetchImpl: async () => Response.json({ version: 1, enabled: true, available: true, count: 1, photos: [photo()] }) });
  client.configure(normalizeDashboardPreferences()); await client.load(); await tick();
  client.setVisible(false); await tick(); assert.equal(clock.timers.size, 0);
  await clock.advance(5000); assert.equal(attempts, 1);
  client.setVisible(true); await tick(); assert.equal(attempts, 2);
  client.dispose(); await tick(); assert.equal(signal.aborted, true); assert.equal(clock.timers.size, 0);
  pending.resolve(); await tick(); await clock.advance(60000); assert.deepEqual(shown, []); assert.equal(attempts, 2); assert.equal(clock.timers.size, 0);
});

test('scope replacement retires Local retry work and late Global decode before showing the active Local image', async () => {
  const clock = slideshowClock(); const pending = deferred(); const shown = []; const urls = []; let globalSignal;
  const local = photo(); const global = photo('b.png');
  const client = createScopedPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel, clear() {}, report() {}, show: row => shown.push(row.url),
    fetchImpl: async url => Response.json(url === '/api/dashboard/photos/local' ? { version: 1, enabled: true, available: true, count: 1, photos: [local] } : { version: 1, instanceId: 'global', revision: 1, serverTime: clock.now(), enabled: true, available: true, loading: false, stale: false, count: 1, current: global, nextChangeAt: null }),
    decode: async (url, { signal }) => { urls.push(url); if (urls.length === 1) throw new Error('Temporary Local failure.'); if (url === global.url) { globalSignal = signal; return pending.promise; } }
  });
  try {
    const settings = normalizeDashboardPreferences(); client.configure(settings, 'local', 'local:0'); await tick(); assert.deepEqual(shown, []);
    client.configure(settings, 'global', 'global:1'); await tick();
    client.configure(settings, 'local', 'local:2'); await tick(); assert.equal(globalSignal.aborted, true);
    pending.resolve(); await tick(); await clock.advance(5000);
    assert.deepEqual(shown, [local.url]); assert.deepEqual(urls, [local.url, global.url, local.url]);
  } finally { client.dispose(); await tick(); }
  assert.equal(clock.timers.size, 0);
});
