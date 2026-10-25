import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedPhotoController } from '../public/dashboard-photo-scope.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { photo, slideshowClock, slideshowSnapshot, snapshotResponse } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

const sharedUrl = '/api/dashboard/slideshow?version=2';
const localUrl = '/api/dashboard/photos/local';
function setup(t, extra = {}) {
  const clock = slideshowClock(); const calls = []; const shown = []; const updates = []; const released = [];
  let frame; let clears = 0; let snapshot = slideshowSnapshot({ current: photo('b.png') });
  const client = createScopedPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel,
    report() {}, clear() { clears++; frame?.resource?.release(); frame = undefined; },
    show(value) { frame?.resource?.release(); frame = value; shown.push(value); }, update: (...args) => updates.push(args),
    decode: async url => ({ release: () => released.push(url) }),
    fetchImpl: async url => { calls.push(url); return url === sharedUrl ? snapshotResponse(snapshot) : Response.json({ version: 1, enabled: true, available: true, count: 1, photos: [photo()] }); }, ...extra });
  t.after(() => client.dispose());
  return { client, clock, calls, shown, updates, released, frame: () => frame, clears: () => clears, set: value => { snapshot = value; } };
}
const preferences = normalizeDashboardPreferences({ interval: 5, order: 'name' });

test('Local defaults to shared selection, presentation updates preserve owner, and opt-out uses only Local manifest', async t => {
  const env = setup(t); env.client.configure(preferences, 'local', 'local:0'); await env.client.load(); await tick();
  assert.deepEqual(env.calls, [sharedUrl]); assert.equal(env.frame().file.name, 'b.png');
  const clears = env.clears(); env.client.configure({ ...preferences, opacity: 0.5 }, 'local', 'local:0');
  assert.equal(env.calls.length, 1); assert.equal(env.clears(), clears); assert.equal(env.updates.at(-1)[1].opacity, 0.5);
  env.client.configure(preferences, 'local', 'local:0', false); assert.equal(env.frame(), undefined);
  await env.client.load(); await tick(); assert.equal(env.frame().file.name, 'a.png');
  const sharedReads = env.calls.filter(url => url === sharedUrl).length; await env.clock.advance(5000);
  assert.equal(env.calls.filter(url => url === sharedUrl).length, sharedReads); assert.ok(env.calls.includes(localUrl));
  env.client.configure(preferences, 'global', 'global:1', false); await env.client.load(); await tick(); assert.equal(env.frame().file.name, 'b.png');
  env.client.dispose(); assert.equal(env.frame(), undefined); assert.equal(env.clock.timers.size, 0);
  assert.ok(env.released.includes(photo().url)); assert.ok(env.released.includes(photo('b.png').url));
});

test('hidden source replacement waits for resume and catches up without independent rotation', async t => {
  const env = setup(t); env.client.setVisible(false); env.client.configure(preferences, 'local', 'local:0'); await tick();
  assert.equal(env.calls.length, 0); env.client.setVisible(true); await tick(); assert.equal(env.frame().file.name, 'b.png');
  env.client.setVisible(false); const count = env.calls.length; await env.clock.advance(10000); assert.equal(env.calls.length, count);
  env.set(slideshowSnapshot({ revision: 2, current: photo() })); env.client.setVisible(true); await tick(); assert.equal(env.frame().file.name, 'a.png');
  assert.ok(env.calls.every(url => url === sharedUrl));
});

test('source replacement releases the retained preview as well as the view-owned foreground', async t => {
  const env = setup(t); env.set(slideshowSnapshot({ version: 2, count: 2, current: photo('b.png'), next: photo(), nextChangeAt: 1_005_000 }));
  env.client.configure(preferences, 'local', 'local:0'); await env.client.load(); await tick();
  assert.equal(env.frame().file.name, 'b.png'); assert.equal(env.released.length, 0);
  env.client.configure(preferences, 'local', 'local:0', false);
  assert.deepEqual(env.released.sort(), [photo().url, photo('b.png').url].sort());
  await env.client.load(); await tick(); assert.equal(env.frame().file.name, 'a.png');
});

test('retired reads and decodes cannot publish after repeated source changes and late resources are released', async t => {
  const read = deferred(); const decode = deferred(); const released = []; let reads = 0; let decodes = 0; const signals = [];
  const env = setup(t, { fetchImpl: async url => url === sharedUrl && ++reads === 1 ? read.promise : url === sharedUrl ? snapshotResponse(slideshowSnapshot({ current: photo('b.png') })) : Response.json({ version: 1, enabled: true, available: true, count: 1, photos: [photo()] }),
    decode: async (_url, { signal }) => { signals.push(signal); if (++decodes === 1) return decode.promise; return { release: () => released.push('active') }; } });
  env.client.configure(preferences, 'local', 'local:0'); await tick();
  env.client.configure(preferences, 'local', 'local:0', false); await env.client.load(); await tick();
  env.client.configure(preferences, 'local', 'local:0', true); await env.client.load(); await tick();
  assert.equal(signals[0].aborted, true); assert.equal(env.frame().file.name, 'b.png'); const count = env.shown.length;
  read.resolve(snapshotResponse(slideshowSnapshot({ current: photo() }))); decode.resolve({ release: () => released.push('late') }); await tick();
  assert.equal(env.shown.length, count); assert.equal(env.frame().file.name, 'b.png'); assert.ok(released.includes('late'));
  env.client.dispose(); await tick(); assert.equal(env.clock.timers.size, 0); assert.ok(released.includes('active'));
});

for (const failure of ['read', 'decode']) test(`replacement ${failure} failure clears old frame and retries the new source`, async t => {
  let broken = false; const env = setup(t, {
    fetchImpl: async url => { if (url === sharedUrl && broken && failure === 'read') throw Error('offline'); return url === sharedUrl ? snapshotResponse(slideshowSnapshot({ current: photo('b.png') })) : Response.json({ version: 1, enabled: true, available: true, count: 1, photos: [photo()] }); },
    decode: async url => { if (url === photo('b.png').url && broken && failure === 'decode') throw Error('decode'); return { release() {} }; } });
  env.client.configure(preferences, 'local', 'local:0', false); await env.client.load(); await tick(); assert.ok(env.frame());
  broken = true; env.client.configure(preferences, 'local', 'local:0', true); await env.client.load(); await tick(); assert.equal(env.frame(), undefined);
  broken = false; await env.clock.advance(5000); assert.equal(env.frame().file.name, 'b.png');
});

test('unchanged-source failures retain last good frame while disabled and empty snapshots clear it', async t => {
  const env = setup(t); env.client.configure(preferences, 'local'); await env.client.load(); await tick(); const frame = env.frame();
  env.set(slideshowSnapshot({ available: false, current: null, count: 0 })); await env.client.load(); assert.equal(env.frame(), frame);
  env.set(slideshowSnapshot({ revision: 2, current: null, count: 0 })); await env.client.load(); assert.equal(env.frame(), undefined);
  env.set(slideshowSnapshot({ revision: 3 })); await env.client.load(); await tick(); assert.ok(env.frame());
  env.set(slideshowSnapshot({ revision: 4, enabled: false, available: false, current: null, count: 0 })); await env.client.load(); assert.equal(env.frame(), undefined);
});
