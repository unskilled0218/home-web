import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoStatusController, formatPhotoLibraryStatus } from '../public/dashboard-photo-status.js';
import { validatePhotoLibraryStatus } from '../public/photo-slideshow-data.js';
import { slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

const status = (extra = {}) => ({ version: 1, enabled: true, available: true, loading: false, complete: true, stale: false, error: null, counts: { supported: 7002, eligible: 7001, filenameExcluded: 1, permissionExcluded: 2, raceExcluded: 3, fileExcluded: 0 }, progress: 7007, ...extra });

test('inventory contract and count text distinguish unknown, zero, exclusions, stale and incomplete results', () => {
  const value = status(); assert.deepEqual(validatePhotoLibraryStatus(value), value);
  const text = formatPhotoLibraryStatus(value); assert.match(text, /7001/); assert.match(text, /Supported files: 7002/); assert.match(text, /Permission-denied files excluded: 2/);
  const unknown = status({ available: false, complete: false, counts: null }); assert.match(formatPhotoLibraryStatus(unknown), /count: unknown/); assert.doesNotThrow(() => validatePhotoLibraryStatus(unknown));
  assert.match(formatPhotoLibraryStatus(status({ counts: { ...value.counts, eligible: 0, supported: 1 } })), /Global playable image files: 0/);
  assert.match(formatPhotoLibraryStatus(status({ complete: false, stale: true, error: 'scan-failed' })), /Last completed count is stale/);
  assert.match(formatPhotoLibraryStatus({ ...unknown, error: 'resource-limit' }), /Discovery is incomplete.*resource limit/);
  for (const extra of [{ counts: { ...value.counts, eligible: 7002 } }, { progress: -1 }, { complete: false }, { stale: true }, { error: 'secret path' }, { enabled: false }, { counts: null }, { other: true }]) assert.throws(() => validatePhotoLibraryStatus({ ...value, ...extra }));
});

test('Settings status owns one poll, pauses and refreshes on reopen, and retains counts on read failure', async () => {
  const clock = slideshowClock(); const reports = []; let reads = 0; let fail = false;
  const client = createPhotoStatusController({ ...clock, report: message => reports.push(message), fetchImpl: async () => { reads++; if (fail) throw new Error('offline'); return Response.json(status()); } });
  client.setVisible(true); await tick(); assert.equal(reads, 1); assert.match(reports.at(-1), /7001/); assert.equal(clock.timers.size, 1);
  client.setVisible(true); await tick(); assert.equal(reads, 1);
  fail = true; await clock.advance(5000); assert.match(reports.at(-1), /7001.*previous count may be stale/);
  client.setVisible(false); assert.equal(clock.timers.size, 0); await clock.advance(60000); assert.equal(reads, 2);
  fail = false; client.setVisible(true); await tick(); assert.equal(reads, 3); client.dispose(); assert.equal(clock.timers.size, 0);
});

test('closing Settings cancels the actual request and rejects delayed status from a retired session', async () => {
  const clock = slideshowClock(); const pending = deferred(); const reports = []; let signal; let reads = 0;
  const client = createPhotoStatusController({ ...clock, report: message => reports.push(message), fetchImpl: async (_url, options) => { signal = options.signal; reads++; return reads === 1 ? pending.promise : Response.json(status({ loading: true })); } });
  client.setVisible(true); await tick(); client.setVisible(false); assert.equal(signal.aborted, true);
  client.setVisible(true); await tick(); assert.equal(reports.length, 1); pending.resolve(Response.json(status())); await tick(); assert.equal(reports.length, 1);
  client.dispose(); assert.equal(clock.timers.size, 0);
});
