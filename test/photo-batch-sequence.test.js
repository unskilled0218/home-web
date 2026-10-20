import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoBatchSequence } from '../public/photo-batch-sequence.js';
import { photo, slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

for (const count of [0, 1, 2, 5, 12, 17, 7001]) for (const interval of [5, 30, 3600]) test(`${count} filenames at ${interval}s cover two bounded cycles`, async () => {
  const rows = Array.from({ length: count }, (_, i) => photo(`${i}-é\".png`));
  const sequence = createPhotoBatchSequence({ interval, random: () => 0.37 }); sequence.reconcile(rows);
  let previous;
  for (let cycle = 0; cycle < 2; cycle++) {
    const names = new Set();
    for (let i = 0; i < count; i++) {
      await sequence.prepare(); await tick();
      const selected = sequence.commit(); assert.ok(selected);
      assert.equal(names.has(selected.name), false); names.add(selected.name);
      if (count > 1) assert.notEqual(selected.name, previous);
      previous = selected.name;
      const stats = sequence.stats(); assert.ok(stats.current <= stats.target); assert.ok(stats.queued <= stats.target); assert.ok(stats.bytes <= 65536);
    }
    assert.equal(names.size, count);
  }
  if (!count) assert.equal(sequence.commit(), null);
  await sequence.stop(); assert.equal(sequence.stats().bytes, 0);
});

test('reservations do not commit, start cycles early, or retain old metadata generations', async () => {
  const sequence = createPhotoBatchSequence({ order: 'name', maxEntries: 2 });
  sequence.reconcile(['a', 'b', 'c'].map(name => photo(name))); const first = sequence.commit(); await tick();
  assert.equal(first.name, 'a'); assert.equal(sequence.stats().visited, 1); assert.equal(sequence.peek().name, 'b');
  const replacement = photo('b', { url: '/api/dashboard/photos/replacementtoken' });
  sequence.reconcile([photo('a'), replacement, photo('d')]); await tick();
  assert.deepEqual(sequence.peek(), replacement); assert.equal(sequence.commit().name, 'b'); await tick();
  assert.equal(sequence.commit().name, 'd'); await tick(); assert.equal(sequence.stats().visited, 0);
  assert.equal(sequence.peek().name, 'a'); await sequence.stop();
});

test('entry/UTF-8 byte limits shrink batches, and interval changes preserve published preview', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => photo(`${i}${'é'.repeat(500)}`));
  const sequence = createPhotoBatchSequence({ maxEntries: 4, maxBytes: 2400 }); sequence.reconcile(rows); sequence.commit(); await tick();
  assert.ok(sequence.stats().current + sequence.stats().queued <= 2); assert.ok(sequence.stats().bytes <= 2400);
  const next = sequence.peek(); sequence.configure({ order: 'random', interval: 3600 }); await tick(); assert.deepEqual(sequence.peek(), next); await sequence.stop();
});

test('one fill owns deferred work; failure retries once and stop drains without late publication', async () => {
  const clock = slideshowClock(); const pending = deferred(); let fills = 0; let changes = 0;
  const sequence = createPhotoBatchSequence({ ...clock, yieldWork: () => { fills++; return pending.promise; }, onChange: () => changes++ });
  sequence.reconcile([photo(), photo('b')]); sequence.commit(); for (let i = 0; i < 100; i++) void sequence.prepare(); await tick(); assert.equal(fills, 1);
  let stopped = false; const stopping = sequence.stop().then(() => { stopped = true; }); await tick(); assert.equal(stopped, false); const before = changes;
  pending.resolve(); await stopping; assert.equal(changes, before); assert.equal(clock.timers.size, 0);
  let attempts = 0; const retrying = createPhotoBatchSequence({ ...clock, yieldWork: async () => { if (++attempts === 1) throw Error('temporary'); } });
  retrying.reconcile([photo(), photo('b')]); retrying.commit(); await tick(); assert.equal(clock.timers.size, 1);
  await clock.advance(5000); assert.ok(retrying.peek()); assert.equal(attempts, 2); await retrying.stop();
});

test('bootstrap counts toward the horizon and deletion replaces an exhausted current without waiting for a fill', async () => {
  let gate; const sequence = createPhotoBatchSequence({ order: 'name', interval: 5, yieldWork: () => gate?.promise });
  sequence.reconcile(Array.from({ length: 20 }, (_, i) => photo(String(i).padStart(2, '0')))); sequence.commit(); await tick();
  assert.equal(sequence.stats().current, 5); assert.equal(sequence.stats().queued, 6); await sequence.stop();
  const tiny = createPhotoBatchSequence({ order: 'name', maxEntries: 1, yieldWork: () => gate?.promise });
  tiny.reconcile([photo('a'), photo('b')]); assert.equal(tiny.commit().name, 'a'); await tick();
  gate = deferred(); assert.equal(tiny.commit().name, 'b'); await tick(); tiny.reconcile([photo('a')]);
  assert.equal(tiny.commit({ replacement: true }).name, 'a'); gate.resolve(); await tiny.stop();
});
