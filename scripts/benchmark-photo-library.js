import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { createPhotoLibrary } from '../src/photo-library.js';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { populatePhotoFiles, SMALL_PNG } from '../test/fixtures/large-photo-library.js';
import { slideshowClock } from '../test/fixtures/photo-slideshow.js';
import { createPhotoBatchSequence } from '../public/photo-batch-sequence.js';

if (!global.gc) throw new Error('Run with node --expose-gc scripts/benchmark-photo-library.js.');
const root = await mkdtemp('/tmp/opencode/photo-benchmark-');
const samples = []; const durationsMs = []; let peakRss = 0; let peakHeap = 0;
function sample(label) {
  const memory = process.memoryUsage(); peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed);
  if (label) samples.push({ label, rss: memory.rss, heapUsed: memory.heapUsed });
  return memory;
}
const clock = slideshowClock();
const library = createPhotoLibrary({ root, ...clock, yieldWork: async () => { sample(); await yieldImmediate(); } });
const slideshow = createPhotoSlideshow({ ...clock, photoLibrary: library, preferences: { order: 'random', interval: 5 }, random: () => 0.37 });
const queue = { selections: 0, maxCurrent: 0, maxQueued: 0, maxBytes: 0, maxPreparationMs: 0, totalPreparationMs: 0 };
try {
  populatePhotoFiles(root, 7001); global.gc(); const baseline = sample('pre-inventory');
  let start = performance.now(); await slideshow.start(); durationsMs.push(performance.now() - start); sample('initial-publication-and-sequence');
  const batches = createPhotoBatchSequence({ random: () => 0.37, interval: 5, yieldWork: async () => { sample(); await yieldImmediate(); } });
  batches.reconcile((await library.refresh()).photos);
  const seen = new Set();
  for (let i = 0; i < 7001; i++) {
    const preparing = performance.now(); await batches.prepare(); const elapsed = performance.now() - preparing;
    queue.maxPreparationMs = Math.max(queue.maxPreparationMs, elapsed); queue.totalPreparationMs += elapsed;
    const photo = batches.commit(); if (!photo || seen.has(photo.name)) throw new Error(`Invalid batch traversal at ${i}.`);
    seen.add(photo.name); queue.selections++;
    const stats = batches.stats(); queue.maxCurrent = Math.max(queue.maxCurrent, stats.current); queue.maxQueued = Math.max(queue.maxQueued, stats.queued); queue.maxBytes = Math.max(queue.maxBytes, stats.bytes);
  }
  await batches.stop(); seen.clear(); sample('complete-batch-traversal');
  await clock.advance(7001 * 5000); await library.refresh(); await yieldImmediate();
  await clock.advance(30001); global.gc(); const warm = sample('warm-settled');
  for (let index = 0; index < 6; index++) {
    if (index === 5) await writeFile(path.join(root, '00000.png'), Buffer.concat([SMALL_PNG, Buffer.from('replacement')]));
    start = performance.now(); await clock.advance(60000); await library.refresh(); await yieldImmediate(); durationsMs.push(performance.now() - start); sample(`publication-${index + 1}`);
    await clock.advance(30001); global.gc(); sample(`settled-${index + 1}`);
  }
  const final = sample('final');
  // getrusage's high-water mark can survive exec from the harness parent. VmHWM describes this process image.
  const vmHwm = /^VmHWM:\s+(\d+) kB$/m.exec(await readFile('/proc/self/status', 'utf8'));
  if (!vmHwm) throw new Error('Linux /proc/self/status VmHWM is required for the process-image RSS peak.');
  const peakProcessRss = Number(vmHwm[1]) * 1024;
  const inheritedResourceUsagePeak = process.resourceUsage().maxRSS * 1024;
  const peakRssIncrease = Math.max(peakRss, peakProcessRss) - baseline.rss;
  const settledHeapGrowth = final.heapUsed - warm.heapUsed;
  const heapTolerance = Math.max(4 * 1024 ** 2, warm.heapUsed * 0.1);
  const passed = slideshow.snapshot().count === 7001 && queue.selections === 7001 && queue.maxBytes <= 65536 && peakRssIncrease <= 128 * 1024 ** 2 && settledHeapGrowth <= heapTolerance;
  console.log(JSON.stringify({ node: process.version, architecture: process.arch, command: 'node --expose-gc scripts/benchmark-photo-library.js', fixture: { count: 7001, bytesPerImage: SMALL_PNG.length, virtualPlaybackSelections: 7001, unchangedRefreshes: 5, replacementRefreshes: 1 }, queue, baseline, peakRss, peakProcessRss, inheritedResourceUsagePeak, peakHeap, peakRssIncrease, settledHeapGrowth, heapTolerance, durationsMs, samples, passed }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await Promise.all([slideshow.stop(), library.stop()]); await rm(root, { recursive: true, force: true });
}
