import test from 'node:test';
import { temporaryPrefix } from '../scripts/temporary.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createPhotoLibrary } from '../src/photo-library.js';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { validateLocalPhotoManifest, validateSlideshowSnapshot } from '../public/photo-slideshow-data.js';
import { populatePhotoFiles, SMALL_PNG } from './fixtures/large-photo-library.js';
import { slideshowClock } from './fixtures/photo-slideshow.js';

test('a 7001-image library supplies bounded Local/legacy pools and rotates the Global selection without browsers', { timeout: 30000 }, async context => {
  const root = mkdtempSync(temporaryPrefix('large-photo-api-')); let store; let slideshow; let server;
  context.after(async () => { await Promise.all([server?.lifecycle.shutdown(), slideshow?.stop()]); store?.close(); rmSync(root, { recursive: true, force: true }); });
  populatePhotoFiles(root, 7001); const clock = slideshowClock(); const library = createPhotoLibrary({ root, now: clock.now }); store = createStore(':memory:');
  slideshow = createPhotoSlideshow({ ...clock, photoLibrary: library, preferences: { order: 'name', interval: 5 } });
  server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store, photoLibrary: library, photoSourceEnabled: true, slideshow });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  await slideshow.start(); const first = slideshow.snapshot(); assert.equal(first.count, 7001); assert.ok(first.current); assert.equal(first.nextChangeAt, clock.now() + 5000);
  await clock.advance(15000); const current = slideshow.snapshot(); assert.equal(current.revision, first.revision + 3); assert.notDeepEqual(current.current, first.current); assert.equal(current.nextChangeAt, clock.now() + 5000);
  const preferences = store.getDashboardPreferences();
  const [sharedResponse, localResponse, legacyResponse] = await Promise.all(['/api/dashboard/slideshow', '/api/dashboard/photos/local', '/api/dashboard/photos'].map(route => fetch(base + route)));
  const sharedText = await sharedResponse.text(); const localText = await localResponse.text(); const legacy = await legacyResponse.json();
  assert.equal(sharedResponse.status, 200); assert.equal(localResponse.status, 200); assert.equal(legacyResponse.status, 200);
  assert.equal(sharedResponse.headers.get('cache-control'), 'no-store'); assert.equal(localResponse.headers.get('cache-control'), 'no-store');
  assert.ok(Buffer.byteLength(sharedText) <= 8192); assert.ok(Buffer.byteLength(localText) <= 262144);
  const shared = validateSlideshowSnapshot(JSON.parse(sharedText)); const local = validateLocalPhotoManifest(JSON.parse(localText));
  assert.deepEqual(shared, current); assert.equal(local.count, 100); assert.equal(local.count, local.photos.length); assert.equal(local.available, true); assert.equal(legacy.available, true); assert.equal(legacy.photos.length, 100);
  assert.deepEqual(slideshow.snapshot(), current); assert.deepEqual(store.getDashboardPreferences(), preferences);
  const statusResponse = await fetch(base + '/api/dashboard/photos/status'); const status = await statusResponse.json();
  assert.equal(status.counts.eligible, 7001); assert.equal(status.complete, true); assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/api/dashboard/photos/status', { method: 'POST' })).status, 405);
  for (const url of [shared.current.url, local.photos.at(-1).url, library.inventory().photos[3500].url, library.inventory().photos.at(-1).url]) {
    const response = await fetch(base + url); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), SMALL_PNG);
  }
  assert.deepEqual(slideshow.snapshot(), current); assert.deepEqual(store.getDashboardPreferences(), preferences);
});

test('Settings and Local cached inventory remain available without Global preferences and recovery does not rescan', async context => {
  const root = mkdtempSync(temporaryPrefix('no-photo-preferences-')); populatePhotoFiles(root, 3); const clock = slideshowClock(); const library = createPhotoLibrary({ root, ...clock });
  let scans = 0; const photoLibrary = { ...library, refresh() { scans++; return library.refresh(); } };
  const slideshow = createPhotoSlideshow({ ...clock, photoLibrary, preferences: null }); const store = createStore(':memory:');
  const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store, photoLibrary, photoSourceEnabled: true, slideshow });
  context.after(async () => { await Promise.all([server.lifecycle.shutdown(), slideshow.stop(), library.stop()]); store.close(); rmSync(root, { recursive: true, force: true }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  await slideshow.start(); assert.equal(scans, 1); assert.equal(slideshow.snapshot().current, null);
  assert.equal((await (await fetch(base + '/api/dashboard/photos/status')).json()).counts.eligible, 3);
  assert.equal((await (await fetch(base + '/api/dashboard/photos/local')).json()).count, 3);
  slideshow.configure({ order: 'name', interval: 5 }); assert.equal(slideshow.snapshot().count, 3); assert.equal(scans, 1); assert.equal(clock.timers.size, 2);
});
