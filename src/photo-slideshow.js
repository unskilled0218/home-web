import { randomBytes, randomInt } from 'node:crypto';
import { validateSlideshowPhoto, validateSlideshowSnapshot } from '../public/photo-slideshow-data.js';
import { createPhotoBatchSequence } from '../public/photo-batch-sequence.js';

const identity = (photo) => photo ? JSON.stringify(photo) : null;

export function createPhotoSlideshow({ photoLibrary, enabled = true, preferences = null, now = Date.now, schedule = setTimeout, cancel = clearTimeout, random = () => randomInt(2 ** 32) / 2 ** 32, yieldWork, instanceId = randomBytes(16).toString('base64url') } = {}) {
  let settings; let started = false; let stopped = false; let scanWork; let stopWork;
  let scanTimer; let rotationTimer; let pool = [];
  let current = null; let revision = 0; let nextChangeAt = null; let available = false; let loading = false; let stale = false;
  let inventoryRevision; let latestInventory; let refreshFailed = false;
  let next = null; let queueRevision = 0;
  const batches = createPhotoBatchSequence({ random, yieldWork, schedule, cancel, onChange: preview });
  function preview() {
    const candidate = pool.length > 1 ? batches.peek() : null;
    const upcoming = candidate?.name !== current?.name ? candidate : null;
    if (identity(upcoming) !== identity(next)) { next = upcoming; queueRevision++; }
  }
  function armRotation() {
    cancel(rotationTimer); rotationTimer = undefined; nextChangeAt = null;
    if (stopped || !started || pool.length < 2) return;
    nextChangeAt = now() + settings.interval * 1000;
    rotationTimer = schedule(() => { rotationTimer = undefined; advance(); }, settings.interval * 1000);
  }
  function select(photo) {
    if (identity(current) !== identity(photo)) { current = photo; revision++; }
    armRotation(); preview();
  }
  function advance() {
    if (stopped || !pool.length) return;
    const photo = batches.commit();
    if (photo) select(photo);
    else { cancel(rotationTimer); nextChangeAt = now() + 5000; rotationTimer = schedule(advance, 5000); }
  }
  function accept(records, contentRevision) {
    if (contentRevision !== undefined && contentRevision === inventoryRevision) { available = true; stale = false; return; }
    const eligible = contentRevision !== undefined ? records : records.flatMap((record) => { try { return [validateSlideshowPhoto(record)]; } catch { return []; } });
    const changed = eligible.length !== pool.length || eligible.some((photo, index) => identity(photo) !== identity(pool[index]));
    inventoryRevision = contentRevision;
    pool = eligible; available = true; stale = false;
    if (!changed) return;
    batches.reconcile(pool);
    const retained = batches.get(current?.name);
    if (!retained) select(pool.length ? batches.commit({ replacement: true }) : null);
    else { if (identity(current) !== identity(retained)) { current = retained; revision++; } if (pool.length < 2 || nextChangeAt === null) armRotation(); }
    preview();
  }
  function refresh() {
    if (stopped || !started || !enabled || scanWork) return scanWork;
    loading = true;
    // Keep the actual filesystem promise owned until it settles, even after stop.
    scanWork = Promise.resolve().then(() => photoLibrary.refresh ? photoLibrary.refresh() : photoLibrary.list()).then((result) => {
      if (stopped) return;
      if (!result.available) { refreshFailed = true; stale = available; return; }
      refreshFailed = false;
      latestInventory = result;
      if (settings) accept(result.photos, result.revision);
    }).catch(() => { if (!stopped) { refreshFailed = true; stale = available; } }).finally(() => {
      loading = false; scanWork = undefined;
      if (!stopped) scanTimer = schedule(() => { scanTimer = undefined; void refresh(); }, 60_000);
    });
    return scanWork;
  }
  function configure(next) {
    if (stopped) return;
    if (!next || !['name', 'date', 'random'].includes(next.order) || !Number.isInteger(next.interval) || next.interval < 5 || next.interval > 3600) throw new Error('Invalid slideshow preferences.');
    const previous = settings; settings = { order: next.order, interval: next.interval };
    batches.configure(settings);
    if (!started) return;
    if (!previous) { if (latestInventory) { accept(latestInventory.photos, latestInventory.revision); stale = refreshFailed && available; } return; }
    if (previous.order !== settings.order) { select(pool.length ? batches.commit() : null); }
    else if (previous.interval !== settings.interval) armRotation();
  }
  if (preferences) configure(preferences);
  return {
    start() { if (started || stopped) return; started = true; return refresh(); },
    configure,
    snapshot({ version = 1 } = {}) { return validateSlideshowSnapshot({ version, instanceId, revision, serverTime: now(), enabled, available, loading, stale, count: pool.length, current: current ? { ...current } : null, nextChangeAt, ...(version === 2 ? { next: next ? { ...next } : null, queueRevision } : {}) }); },
    stop() {
      if (stopWork) return stopWork;
      stopped = true; cancel(scanTimer); cancel(rotationTimer); nextChangeAt = null;
      if (current) revision++;
      if (next) queueRevision++;
      current = null; next = null; pool = []; latestInventory = undefined; available = false; stale = false; loading = false;
      stopWork = Promise.all([scanWork, batches.stop()]).then(() => {});
      return stopWork;
    }
  };
}
