import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDashboardServer } from '../src/app.js';
import { createStore } from '../src/db.js';
import { createPhotoLibrary } from '../src/photo-library.js';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { validateSlideshowSnapshot } from '../public/photo-slideshow-data.js';
import { photo, slideshowClock, slideshowSnapshot } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

async function environment(t, options = {}) {
  const directory = await mkdtemp('/tmp/opencode/slideshow-api-'); const store = createStore(path.join(directory, 'app.db')); const clock = slideshowClock();
  const photoLibrary = options.photoLibrary ?? { list: async () => ({ available: true, photos: [photo(), photo('b.png')] }), open: async () => null };
  const service = createPhotoSlideshow({ ...clock, photoLibrary, preferences: store.getDashboardPreferences().preferences });
  const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store, photoLibrary, slideshow: options.absent ? undefined : options.slideshow ?? service });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await Promise.all([service.stop(), server.lifecycle.shutdown()]); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { base, store, clock, service, server, directory };
}

test('snapshot API is bounded, read-only, no-store and protected by existing method/host/origin rules', async (t) => {
  const env = await environment(t); await env.service.start(); await env.clock.advance(60_000);
  const before = env.service.snapshot(); const results = await Promise.all(Array.from({ length: 8 }, () => fetch(`${env.base}/api/dashboard/slideshow`)));
  for (const response of results) { assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(validateSlideshowSnapshot(await response.json()), before); }
  assert.deepEqual(env.service.snapshot(), before); assert.equal(env.store.getDashboardPreferences().revision, 0);
  assert.equal((await fetch(`${env.base}/api/dashboard/slideshow`, { method: 'POST' })).status, 405);
  const forbiddenHost = await new Promise((resolve, reject) => { const request = http.get(`${env.base}/api/dashboard/slideshow`, { headers: { Host: 'evil.test' } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); });
  assert.equal(forbiddenHost, 403);
  assert.equal((await fetch(`${env.base}/api/dashboard/slideshow`, { method: 'POST', headers: { Origin: 'https://evil.test' } })).status, 403);
});

test('missing or invalid producer service returns a bounded unavailable response', async (t) => {
  for (const options of [{ absent: true }, { slideshow: { snapshot: () => slideshowSnapshot({ current: photo('../bad.png') }) } }, { slideshow: { snapshot: () => slideshowSnapshot({ extra: 'x'.repeat(9000) }) } }]) {
    const env = await environment(t, options); const response = await fetch(`${env.base}/api/dashboard/slideshow`); assert.equal(response.status, 503); assert.ok(Buffer.byteLength(await response.text()) < 8192);
  }
});

test('version negotiation publishes only current/next metadata and rejects unsupported explicit versions', async t => {
  const env = await environment(t); await env.service.start(); await tick();
  const before = env.service.snapshot({ version: 2 });
  assert.equal((await (await fetch(`${env.base}/api/dashboard/slideshow`)).json()).version, 1);
  const response = await fetch(`${env.base}/api/dashboard/slideshow?version=2`); assert.equal(response.status, 200);
  assert.deepEqual(validateSlideshowSnapshot(await response.json()), before); assert.notEqual(before.current.name, before.next.name);
  for (const query of ['version=3', 'version=', 'version=02', 'version=2&version=2']) {
    const invalid = await fetch(`${env.base}/api/dashboard/slideshow?${query}`); assert.equal(invalid.status, 400); assert.ok((await invalid.text()).length < 100);
  }
  assert.deepEqual(env.service.snapshot({ version: 2 }), before);
});

test('initial scans return loading snapshots promptly without request-owned discovery', async (t) => {
  const work = deferred(); let scans = 0;
  const env = await environment(t, { photoLibrary: { list() { scans++; return work.promise; } } }); const starting = env.service.start(); await tick();
  try {
    const response = await fetch(`${env.base}/api/dashboard/slideshow`); const state = validateSlideshowSnapshot(await response.json()); assert.equal(state.loading, true); assert.equal(state.current, null); assert.equal(scans, 1);
  } finally { work.resolve({ available: true, photos: [] }); await starting; }
});

test('successful initialization/save configures committed preferences; conflicts and unrelated saves preserve selection/deadline', async (t) => {
  const env = await environment(t); await env.service.start();
  const send = (route, method, data) => fetch(`${env.base}${route}`, { method, headers: { 'Content-Type': 'application/json', Origin: env.base }, body: JSON.stringify(data) });
  const preferences = normalizeDashboardPreferences({ order: 'name', interval: 5 });
  let response = await send('/api/dashboard/settings/initialize', 'POST', { preferences }); assert.equal(response.status, 200);
  await env.clock.advance(5000); const before = env.service.snapshot();
  response = await send('/api/dashboard/settings', 'PUT', { revision: 1, preferences: { ...preferences, color: '#123456' } }); assert.equal(response.status, 200); assert.deepEqual(env.service.snapshot(), before);
  response = await send('/api/dashboard/settings', 'PUT', { revision: 1, preferences }); assert.equal(response.status, 409); assert.deepEqual(env.service.snapshot(), before);
  response = await send('/api/dashboard/settings', 'PUT', { revision: 2, preferences: { ...preferences, interval: 30 } }); assert.equal(response.status, 200); assert.equal(env.service.snapshot().nextChangeAt, env.clock.now() + 30_000);
  response = await send('/api/dashboard/settings', 'PUT', { revision: 3, preferences: { ...preferences, interval: 0 } }); assert.equal(response.status, 400);
  assert.equal(env.service.snapshot().nextChangeAt, env.clock.now() + 30_000);
  const snapshot = env.service.snapshot(); const save = env.store.saveDashboardPreferences;
  env.store.saveDashboardPreferences = () => { throw new Error('fixture persistence failure'); };
  response = await send('/api/dashboard/settings', 'PUT', { revision: 3, preferences }); assert.equal(response.status, 503); assert.deepEqual(env.service.snapshot(), snapshot); env.store.saveDashboardPreferences = save;
});

test('notification failure cannot turn an already committed preference save into failure', async (t) => {
  const env = await environment(t, { slideshow: { configure() { throw new Error('fixture'); }, snapshot: () => slideshowSnapshot() } });
  const response = await fetch(`${env.base}/api/dashboard/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, preferences: normalizeDashboardPreferences() }) });
  assert.equal(response.status, 200); assert.equal(env.store.getDashboardPreferences().revision, 1);
});

test('real library/service/API round trip filters transport-ineligible names without altering legacy streams', async (t) => {
  const root = await mkdtemp('/tmp/opencode/slideshow-names-'); t.after(() => rm(root, { recursive: true, force: true }));
  const longDirectory = path.join(root, ...Array.from({ length: 5 }, (_, i) => `${i}${'x'.repeat(219)}`)); await mkdir(longDirectory, { recursive: true });
  const names = ['日"本.png', 'plain.png', 'control\n.png', path.relative(root, path.join(longDirectory, 'long.png'))];
  for (const name of names) await writeFile(path.join(root, name), 'image');
  const library = createPhotoLibrary({ root }); await library.refresh(); const legacy = await library.list(); assert.equal(legacy.photos.length, 4);
  const env = await environment(t, { photoLibrary: library }); env.service.configure({ order: 'name', interval: 5 }); await env.service.start();
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    const response = await fetch(`${env.base}/api/dashboard/slideshow`); const body = await response.text(); assert.ok(Buffer.byteLength(body) <= 8192); const state = validateSlideshowSnapshot(JSON.parse(body));
    assert.equal(state.count, 2); seen.add(state.current.name); await env.clock.advance(5000);
  }
  assert.deepEqual([...seen].sort(), ['plain.png', '日"本.png'].sort());
  const current = env.service.snapshot(); const token = current.current.url.split('/').at(-1); const held = await Promise.all(Array.from({ length: 8 }, () => library.open(token)));
  try {
    assert.ok(held.every(Boolean)); const snapshots = await Promise.all(Array.from({ length: 8 }, () => fetch(`${env.base}/api/dashboard/slideshow`).then((response) => response.json()))); snapshots.forEach((state) => assert.deepEqual(state, current));
    assert.equal((await fetch(env.base + current.current.url)).status, 404, 'snapshot reads cannot bypass stream admission');
  } finally { await Promise.all(held.filter(Boolean).map(({ stream }) => { const closed = once(stream, 'close'); stream.destroy(); return closed; })); }
  for (const row of legacy.photos) { const response = await fetch(env.base + row.url); assert.equal(response.status, 200); assert.equal(await response.text(), 'image'); }
  await rm(path.join(root, 'plain.png')); await rm(path.join(root, '日"本.png')); await env.clock.advance(60_000);
  for (let i = 0; i < 2000 && env.service.snapshot().loading; i++) await tick();
  assert.equal(env.service.snapshot().loading, false, 'real filesystem refresh settled');
  const empty = validateSlideshowSnapshot(await (await fetch(`${env.base}/api/dashboard/slideshow`)).json()); assert.equal(empty.available, true); assert.equal(empty.count, 0); assert.equal(empty.current, null);
  assert.equal((await library.list()).photos.length, 2); await tick();
});
