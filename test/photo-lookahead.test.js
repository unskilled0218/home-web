import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoController } from '../public/dashboard-photos.js';
import { createLocalPhotoController } from '../public/dashboard-local-photos.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { photo, slideshowClock, slideshowSnapshot, snapshotResponse } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

const state = extra => slideshowSnapshot({ version: 2, count: 3, nextChangeAt: 1_005_000, ...extra });
function environment(extra = {}) {
  const clock = slideshowClock(); let snapshot = state({}); let reads = 0; const shown = []; const decoded = []; const released = [];
  const client = createPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel, report() {}, clear() {},
    show: value => shown.push(value), fetchImpl: async () => { reads++; return snapshotResponse(snapshot); },
    decode: async url => { const resource = { image: { url }, release: () => released.push(url) }; decoded.push(resource); return resource; }, ...extra });
  client.configure(normalizeDashboardPreferences());
  return { client, clock, shown, decoded, released, reads: () => reads, set: value => { snapshot = value; } };
}

test('Global null-preview polling delivers late preparation without redisplay, then promotes the retained resource', async () => {
  const env = environment(); await env.client.load(); await tick(); const current = env.shown[0]; assert.equal(env.decoded.length, 1);
  await env.clock.advance(499); assert.equal(env.reads(), 1);
  env.set(state({ queueRevision: 1, next: photo('b.png') })); await env.clock.advance(1); assert.equal(env.reads(), 2);
  assert.equal(env.shown.length, 1); assert.equal(env.shown[0], current); assert.equal(env.decoded.length, 2);
  await env.clock.advance(500); assert.equal(env.reads(), 2, 'ready preview restores deadline-aware polling');
  env.set(state({ revision: 2, queueRevision: 2, current: photo('b.png'), next: photo('c.png'), serverTime: 1_005_000, nextChangeAt: 1_010_000 }));
  await env.client.load(); await tick(); assert.equal(env.shown[1].resource, env.decoded[1]); assert.equal(env.decoded.length, 3);
  env.client.dispose(); assert.equal(env.released.length, 1, 'view owns promoted resources; controller releases only speculative resource');
});

test('metadata arriving during current decode queues intent; preview revisions reject stale/inconsistent updates', async () => {
  const pending = deferred(); const urls = []; const resource = { image: {}, release() {} };
  const env = environment({ decode: url => { urls.push(url); return urls.length === 1 ? pending.promise : Promise.resolve(resource); } });
  await env.client.load(); env.set(state({ queueRevision: 2, next: photo('b.png') })); await env.client.load(); assert.equal(urls.length, 1);
  pending.resolve(resource); await tick(); assert.equal(urls.length, 2); assert.equal(env.shown.length, 1);
  env.set(state({ queueRevision: 1, next: photo('c.png') })); await env.client.load();
  env.set(state({ queueRevision: 2, next: photo('c.png') })); await env.client.load(); assert.equal(urls.length, 2);
  env.client.dispose();
});

test('speculative failure preserves frame and retries within five seconds without new metadata', async () => {
  let attempts = 0; const shown = [];
  const env = environment({ autoPoll: false, show: value => shown.push(value), decode: async url => { attempts++; if (url === photo('b.png').url && attempts === 2) throw Error('broken'); } });
  env.set(state({ next: photo('b.png') })); await env.client.load(); await tick(); assert.equal(attempts, 2); assert.equal(shown.length, 1);
  await env.clock.advance(5000); assert.equal(attempts, 3); assert.equal(shown.length, 1); env.client.dispose();
});

test('late speculative resources are released after suspension and URL replacement; urgent current takes priority', async () => {
  const pending = deferred(); const released = []; const urls = [];
  const env = environment({ decode: async url => { urls.push(url); if (urls.length === 2) return pending.promise; return { release: () => released.push(url) }; } });
  env.set(state({ next: photo('b.png') })); await env.client.load(); await tick();
  const replacement = photo('b.png', { url: '/api/dashboard/photos/replacedphotourl' });
  env.set(state({ revision: 2, queueRevision: 1, current: replacement, next: null })); await env.client.load(); await tick(); assert.equal(urls.length, 3);
  pending.resolve({ release: () => released.push('obsolete') }); await tick(); assert.ok(released.includes('obsolete')); assert.equal(env.shown.at(-1).url, replacement.url);
  env.client.setVisible(false); assert.equal(env.clock.timers.size, 0); env.client.dispose();
});

test('failed readiness read retains five-second recovery and never overlaps metadata work', async () => {
  let reads = 0; const pending = deferred();
  const env = environment({ fetchImpl: async () => { if (++reads === 1) return snapshotResponse(state({})); if (reads === 2) throw Error('offline'); return pending.promise; } });
  await env.client.load(); await env.clock.advance(500); assert.equal(reads, 2);
  await env.clock.advance(4999); assert.equal(reads, 2); await env.clock.advance(1); assert.equal(reads, 3);
  void env.client.load(); await env.clock.advance(500); assert.equal(reads, 3); env.client.dispose(); pending.resolve(snapshotResponse(state({}))); await tick(); assert.equal(env.clock.timers.size, 0);
});

test('Local deferred fill notifies a nonpolling follower before five-second selection and across a batch boundary', async () => {
  const clock = slideshowClock(); let pending = deferred(); const urls = []; const shown = []; let manifests = 0;
  const photos = Array.from({ length: 15 }, (_, i) => photo(`${String(i).padStart(2, '0')}.png`, { url: `/api/dashboard/photos/${String(i).padStart(16, 'a')}` }));
  const client = createLocalPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel, yieldWork: () => pending?.promise,
    report() {}, clear() {}, show: value => shown.push(value), decode: async url => { urls.push(url); return { release() {} }; },
    fetchImpl: async () => { manifests++; return Response.json({ version: 1, enabled: true, available: true, count: photos.length, photos }); } });
  client.configure(normalizeDashboardPreferences({ order: 'name', interval: 5 })); await client.load(); await tick();
  assert.deepEqual(urls, [photos[0].url]); const frame = shown[0];
  pending.resolve(); pending = undefined; await tick(); assert.deepEqual(urls, [photos[0].url, photos[1].url]); assert.equal(shown[0], frame); assert.equal(shown.length, 1);
  for (let i = 1; i <= 8; i++) { await clock.advance(5000); assert.equal(shown.at(-1).url, photos[i].url); assert.ok(urls.includes(photos[i + 1].url)); }
  assert.equal(manifests, 1); client.setVisible(false); client.setVisible(true); await tick(); assert.equal(shown.length, 9); await client.dispose(); assert.equal(clock.timers.size, 0);
});

test('Local fill completing during snapshot consumption cannot be swallowed by the older delivery', async () => {
  const clock = slideshowClock(); const pending = deferred(); const urls = []; const shown = [];
  const photos = [photo(), photo('b.png')];
  const client = createLocalPhotoController({ ...clock, yieldWork: () => pending.promise, report() {}, clear() {}, show: value => shown.push(value),
    decode: async url => { urls.push(url); if (urls.length === 1) pending.resolve(); },
    fetchImpl: async () => Response.json({ version: 1, enabled: true, available: true, count: 2, photos }) });
  client.configure(normalizeDashboardPreferences({ order: 'name', interval: 5 })); await client.load(); await tick();
  assert.deepEqual(urls, photos.map(row => row.url)); assert.equal(shown.length, 1); await client.dispose(); assert.equal(clock.timers.size, 0);
});

test('Local hidden completion cannot publish lookahead; resume consumes fresh preview without a selection', async () => {
  const clock = slideshowClock(); const pending = deferred(); const urls = []; const shown = [];
  const client = createLocalPhotoController({ ...clock, yieldWork: () => pending.promise, report() {}, clear() {}, show: value => shown.push(value), decode: async url => { urls.push(url); },
    fetchImpl: async () => Response.json({ version: 1, enabled: true, available: true, count: 2, photos: [photo(), photo('b.png')] }) });
  client.configure(normalizeDashboardPreferences({ order: 'name', interval: 5 })); await client.load(); await tick();
  client.setVisible(false); pending.resolve(); await tick(); assert.equal(urls.length, 1); assert.equal(shown.length, 1);
  client.setVisible(true); await tick(); assert.equal(urls.length, 2); assert.equal(shown.length, 1); await client.dispose(); assert.equal(clock.timers.size, 0);
});

test('an in-flight preview becomes current without another decode, and preview-only changes preserve urgent work', async () => {
  const current = deferred(); const upcoming = deferred(); const urls = []; const signals = [];
  const resource = { release() {} };
  const env = environment({ decode: (url, { signal }) => { urls.push(url); signals.push(signal); return urls.length === 1 ? current.promise : upcoming.promise; } });
  await env.client.load(); env.set(state({ queueRevision: 1, next: photo('b.png') })); await env.client.load();
  assert.equal(signals[0].aborted, false); current.resolve(resource); await tick(); assert.equal(urls.length, 2);
  env.set(state({ revision: 2, queueRevision: 2, current: photo('b.png'), next: null })); await env.client.load();
  assert.equal(signals[1].aborted, false); assert.equal(urls.length, 2); assert.equal(env.shown.length, 1);
  upcoming.resolve(resource); await tick(); assert.equal(env.shown.length, 2); assert.equal(env.shown[1].resource, resource); env.client.dispose();
});
