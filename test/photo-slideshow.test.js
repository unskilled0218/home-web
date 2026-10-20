import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';
import { photo, slideshowClock } from './fixtures/photo-slideshow.js';

function environment(extra = {}) {
  const clock = slideshowClock(); let scans = 0; let result = { available: true, photos: [photo(), photo('b.png')] };
  const service = createPhotoSlideshow({ ...clock, preferences: { order: 'name', interval: 5 }, photoLibrary: { list() { scans++; return result; } }, ...extra });
  return { service, clock, scans: () => scans, setResult(value) { result = value; } };
}

test('server starts and rotates without clients; snapshot reads are pure and late timers advance once', async () => {
  const { service, clock, scans } = environment(); assert.equal(scans(), 0); assert.equal(clock.timers.size, 0);
  await service.start(); assert.equal(scans(), 1); assert.equal(service.snapshot().current.name, 'a.png');
  await clock.advance(15_000); assert.equal(service.snapshot().current.name, 'b.png'); assert.equal(service.snapshot().revision, 4);
  const before = service.snapshot(); for (let i = 0; i < 100; i++) assert.deepEqual(service.snapshot(), before);
  assert.equal(scans(), 1); assert.equal(clock.timers.size, 2);
  await clock.late(30_000); assert.equal(service.snapshot().revision, 5); assert.equal(service.snapshot().nextChangeAt, clock.now() + 5000);
  await service.stop(); assert.equal(clock.timers.size, 0);
});

test('configuration changes only ordering or interval, preserving unrelated saves and unchanged rescan deadlines', async () => {
  const { service, clock, setResult } = environment(); await service.start(); await clock.advance(5000);
  const original = service.snapshot(); const timers = [...clock.timers];
  service.configure({ order: 'name', interval: 5, color: '#123456' }); assert.deepEqual(service.snapshot(), original); assert.deepEqual([...clock.timers], timers);
  service.configure({ order: 'name', interval: 60 }); assert.equal(service.snapshot().current.name, 'b.png'); assert.equal(service.snapshot().nextChangeAt, clock.now() + 60_000);
  await clock.advance(55_000); assert.equal(service.snapshot().current.name, 'b.png'); assert.equal(service.snapshot().nextChangeAt, original.serverTime + 60_000);
  setResult({ available: true, photos: [photo('a.png', { lastModified: 10 }), photo('b.png', { lastModified: 1 })] });
  service.configure({ order: 'date', interval: 60 }); assert.equal(service.snapshot().current.name, 'a.png');
  await clock.advance(60_000); assert.equal(service.snapshot().current.name, 'b.png'); await service.stop();
});

test('name/date ordering preserves existing sort semantics without mutating library records', async () => {
  const records = [photo('z.png', { lastModified: 1 }), photo('a.png', { lastModified: 2 }), photo('b.png', { lastModified: 1 })]; const original = structuredClone(records);
  const { service, clock } = environment({ photoLibrary: { list: async () => ({ available: true, photos: records }) } }); await service.start(); assert.equal(service.snapshot().current.name, 'a.png');
  service.configure({ order: 'date', interval: 5 }); assert.equal(service.snapshot().current.name, 'b.png'); await tick(); await clock.advance(5000); assert.equal(service.snapshot().current.name, 'z.png'); await clock.advance(5000); assert.equal(service.snapshot().current.name, 'a.png'); assert.deepEqual(records, original); await service.stop();
});

test('random cycles traverse every photo and avoid boundary repeats without reshuffling unchanged scans', async () => {
  let randomCalls = 0; const records = [photo(), photo('b.png'), photo('c.png', { url: '/api/dashboard/photos/cccccccccccccccc' })];
  const { service, clock } = environment({ random: () => { randomCalls++; return 0; }, preferences: { order: 'random', interval: 60 }, photoLibrary: { list: async () => ({ available: true, photos: records }) } });
  await service.start(); await tick(); const names = [service.snapshot().current.name]; const initialCalls = randomCalls;
  for (let i = 0; i < 20; i++) service.snapshot(); assert.equal(randomCalls, initialCalls);
  for (let i = 0; i < 6; i++) { await clock.advance(60_000); names.push(service.snapshot().current.name); }
  assert.equal(new Set(names.slice(0, 3)).size, 3); assert.notEqual(names[2], names[3]); assert.equal(new Set(names.slice(3, 6)).size, 3); assert.ok(randomCalls <= 12);
  await service.stop();
});

test('slow refresh never overlaps scans or pauses last-good rotation; stop drains the actual scan', async () => {
  const pending = deferred(); let calls = 0;
  const { service, clock } = environment({ photoLibrary: { list() { return ++calls === 1 ? { available: true, photos: [photo(), photo('b.png')] } : pending.promise; } } });
  await service.start(); await clock.advance(60_000); assert.equal(calls, 2); assert.equal(service.snapshot().loading, true);
  const revision = service.snapshot().revision; await clock.advance(180_000); assert.equal(calls, 2); assert.ok(service.snapshot().revision > revision); assert.equal(clock.timers.size, 1);
  let drained = false; const stopping = service.stop().then(() => { drained = true; }); assert.equal(service.stop(), service.stop()); await tick(); assert.equal(drained, false); assert.equal(clock.timers.size, 0);
  const stopped = service.snapshot(); pending.resolve({ available: true, photos: [photo('late.png')] }); await stopping; assert.deepEqual(service.snapshot(), stopped); assert.equal(clock.timers.size, 0);
});

test('failure and recovery retain stale selection, confirmed empty clears, and metadata replacement changes selection', async () => {
  const { service, clock, setResult } = environment(); await service.start();
  service.configure({ order: 'name', interval: 3600 }); const first = service.snapshot();
  setResult({ available: false, photos: [] }); await clock.advance(60_000); assert.equal(service.snapshot().stale, true); assert.deepEqual(service.snapshot().current, first.current);
  setResult({ available: true, photos: [photo('b.png')] }); await clock.advance(60_000); assert.equal(service.snapshot().current.name, 'b.png'); assert.equal(service.snapshot().nextChangeAt, null);
  setResult({ available: true, photos: [photo('b.png', { lastModified: 2, url: '/api/dashboard/photos/newnewnewnewnewn' })] }); await clock.advance(60_000); assert.equal(service.snapshot().current.lastModified, 2);
  setResult({ available: true, photos: [] }); await clock.advance(60_000); assert.equal(service.snapshot().current, null); assert.equal(service.snapshot().available, true); assert.equal(clock.timers.size, 1); await service.stop();
});

test('unconfigured services discover without inventing preferences and recover from cache; disabled sources never scan', async () => {
  const { service, clock, scans, setResult } = environment({ preferences: null }); await service.start(); assert.equal(service.snapshot().available, false); assert.equal(service.snapshot().current, null); assert.equal(scans(), 1); assert.equal(clock.timers.size, 1);
  service.configure({ order: 'name', interval: 5 }); assert.equal(service.snapshot().current.name, 'a.png'); assert.equal(scans(), 1); assert.equal(clock.timers.size, 2);
  setResult({ available: true, photos: [photo()] }); await clock.advance(60_000); assert.equal(service.snapshot().available, true); assert.equal(service.snapshot().nextChangeAt, null); assert.equal(clock.timers.size, 1); await service.stop();
  const disabled = environment({ enabled: false }); await disabled.service.start(); assert.equal(disabled.scans(), 0); assert.equal(disabled.service.snapshot().enabled, false); assert.equal(disabled.clock.timers.size, 0); await disabled.service.stop();
});

for (const order of ['name', 'date', 'random']) test(`${order} traverses all 7001 records across unchanged refreshes without omission or premature repetition`, async () => {
  const records = Array.from({ length: 7001 }, (_, i) => photo(`${String(i).padStart(5, '0')}.png`, { lastModified: 7001 - i, url: `/api/dashboard/photos/token${String(i).padStart(16, '0')}` }));
  let scans = 0; const clock = slideshowClock();
  const service = createPhotoSlideshow({ ...clock, random: () => 0.37, preferences: { order, interval: 5 }, photoLibrary: { refresh: async () => { scans++; return { available: true, revision: 'unchanged', photos: records }; } } });
  try {
    await service.start(); const seen = new Set();
    for (let index = 0; index < records.length; index++) {
      const state = service.snapshot(); assert.equal(state.count, 7001); assert.equal(seen.has(state.current.name), false, `premature repeat at ${index}`); seen.add(state.current.name);
      if (order !== 'random') assert.equal(state.current.name, records[order === 'name' ? index : records.length - index - 1].name);
      await clock.advance(5000);
    }
    assert.equal(seen.size, 7001); assert.ok(scans > 500); assert.equal(clock.timers.size, 2);
    if (order === 'random') assert.notEqual(service.snapshot().current.name, [...seen].at(-1));
  } finally { await service.stop(); }
  assert.equal(clock.timers.size, 0);
});

test('preference recovery keeps cached inventory marked stale when the latest discovery failed', async () => {
  const { service, clock, scans, setResult } = environment({ preferences: null });
  await service.start(); setResult({ available: false, photos: [] }); await clock.advance(60000);
  assert.equal(scans(), 2); assert.equal(service.snapshot().available, false);
  service.configure({ order: 'name', interval: 5 }); assert.equal(service.snapshot().count, 2); assert.equal(service.snapshot().stale, true); assert.equal(scans(), 2);
  await service.stop();
});

test('eligibility filters before selection, counts only valid records, and all-rejected rescan is authoritative empty', async () => {
  const { service, clock, setResult } = environment(); const records = [photo('../bad.png'), photo('a.png'), photo('a\n.png'), photo('é'.repeat(513))];
  setResult({ available: true, photos: records }); await service.start(); assert.equal(service.snapshot().count, 1); assert.equal(service.snapshot().current.name, 'a.png'); assert.equal(records.length, 4);
  setResult({ available: true, photos: records.filter((row) => row.name !== 'a.png') }); await clock.advance(60_000); assert.equal(service.snapshot().count, 0); assert.equal(service.snapshot().current, null); assert.equal(service.snapshot().available, true); assert.equal(clock.timers.size, 1); await service.stop();
});

test('long-lived reserved filenames resolve refreshed URLs without resetting deadline or surviving visited progress', async () => {
  const rows = ['a', 'b', 'c', 'd'].map(name => photo(name));
  const env = environment({ preferences: { order: 'name', interval: 3600 }, photoLibrary: { list: () => ({ available: true, photos: rows }) } });
  await env.service.start(); await tick(); const before = env.service.snapshot({ version: 2 });
  rows[1] = photo('b', { url: '/api/dashboard/photos/replacementtoken' }); rows.push(photo('e'));
  await env.clock.advance(60000); const after = env.service.snapshot({ version: 2 });
  assert.equal(after.next.url, rows[1].url); assert.equal(after.revision, before.revision); assert.equal(after.nextChangeAt, before.nextChangeAt); assert.ok(after.queueRevision > before.queueRevision);
  env.service.configure({ order: 'name', interval: 5 }); await env.clock.advance(5000); assert.equal(env.service.snapshot().current.url, rows[1].url);
  const seen = ['a', 'b']; for (let i = 0; i < 3; i++) { await env.clock.advance(5000); seen.push(env.service.snapshot().current.name); }
  assert.deepEqual(seen, ['a', 'b', 'c', 'd', 'e']); await env.service.stop();
});

test('stop drains deferred metadata preparation and prevents late preview publication', async () => {
  const pending = deferred(); const env = environment({ yieldWork: () => pending.promise }); await env.service.start();
  assert.equal(env.service.snapshot({ version: 2 }).next, null); let drained = false;
  const stopping = env.service.stop().then(() => { drained = true; }); await tick(); assert.equal(drained, false);
  pending.resolve(); await stopping; assert.equal(env.service.snapshot({ version: 2 }).next, null); assert.equal(env.clock.timers.size, 0);
});
