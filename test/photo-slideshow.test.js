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
  service.configure({ order: 'date', interval: 5 }); assert.equal(service.snapshot().current.name, 'b.png'); await clock.advance(5000); assert.equal(service.snapshot().current.name, 'z.png'); await clock.advance(5000); assert.equal(service.snapshot().current.name, 'a.png'); assert.deepEqual(records, original); await service.stop();
});

test('random cycles traverse every photo and avoid boundary repeats without reshuffling unchanged scans', async () => {
  let randomCalls = 0; const records = [photo(), photo('b.png'), photo('c.png', { url: '/api/dashboard/photos/cccccccccccccccc' })];
  const { service, clock } = environment({ random: () => { randomCalls++; return 0; }, preferences: { order: 'random', interval: 60 }, photoLibrary: { list: async () => ({ available: true, photos: records }) } });
  await service.start(); const names = [service.snapshot().current.name]; assert.equal(randomCalls, 2);
  for (let i = 0; i < 6; i++) { await clock.advance(60_000); names.push(service.snapshot().current.name); }
  assert.equal(new Set(names.slice(0, 3)).size, 3); assert.notEqual(names[2], names[3]); assert.equal(new Set(names.slice(3, 6)).size, 3); assert.equal(randomCalls, 6);
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

test('initial unavailable and unconfigured services recover without inventing preferences; disabled sources never scan', async () => {
  const { service, clock, setResult } = environment({ preferences: null }); await service.start(); assert.equal(service.snapshot().available, false); assert.equal(clock.timers.size, 0);
  setResult({ available: false, photos: [] }); service.configure({ order: 'name', interval: 5 }); await tick(); assert.equal(service.snapshot().current, null);
  setResult({ available: true, photos: [photo()] }); await clock.advance(60_000); assert.equal(service.snapshot().available, true); assert.equal(service.snapshot().nextChangeAt, null); assert.equal(clock.timers.size, 1); await service.stop();
  const disabled = environment({ enabled: false }); await disabled.service.start(); assert.equal(disabled.scans(), 0); assert.equal(disabled.service.snapshot().enabled, false); assert.equal(disabled.clock.timers.size, 0); await disabled.service.stop();
});

test('eligibility filters before selection, counts only valid records, and all-rejected rescan is authoritative empty', async () => {
  const { service, clock, setResult } = environment(); const records = [photo('../bad.png'), photo('a.png'), photo('a\n.png'), photo('é'.repeat(513))];
  setResult({ available: true, photos: records }); await service.start(); assert.equal(service.snapshot().count, 1); assert.equal(service.snapshot().current.name, 'a.png'); assert.equal(records.length, 4);
  setResult({ available: true, photos: records.filter((row) => row.name !== 'a.png') }); await clock.advance(60_000); assert.equal(service.snapshot().count, 0); assert.equal(service.snapshot().current, null); assert.equal(service.snapshot().available, true); assert.equal(clock.timers.size, 1); await service.stop();
});
