import { randomBytes, randomInt } from 'node:crypto';
import { validateSlideshowPhoto, validateSlideshowSnapshot } from '../public/photo-slideshow-data.js';

const identity = (photo) => photo ? JSON.stringify(photo) : null;
const compare = (order) => (a, b) => (order === 'date' ? a.lastModified - b.lastModified : 0) || a.name.localeCompare(b.name);

export function createPhotoSlideshow({ photoLibrary, enabled = true, preferences = null, now = Date.now, schedule = setTimeout, cancel = clearTimeout, random, instanceId = randomBytes(16).toString('base64url') } = {}) {
  let settings; let started = false; let stopped = false; let scanWork; let stopWork;
  let scanTimer; let rotationTimer; let pool = []; let sequence = []; let index = -1;
  let current = null; let revision = 0; let nextChangeAt = null; let available = false; let loading = false; let stale = false;

  function ordered(records) {
    const result = [...records];
    if (settings.order !== 'random') return result.sort(compare(settings.order));
    for (let i = result.length - 1; i > 0; i--) { const j = random ? Math.floor(random() * (i + 1)) : randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
    if (result.length > 1 && identity(result[0]) === identity(current)) [result[0], result[1]] = [result[1], result[0]];
    return result;
  }
  function armRotation() {
    cancel(rotationTimer); rotationTimer = undefined; nextChangeAt = null;
    if (stopped || !started || pool.length < 2) return;
    nextChangeAt = now() + settings.interval * 1000;
    rotationTimer = schedule(() => { rotationTimer = undefined; advance(); }, settings.interval * 1000);
  }
  function select(photo) {
    if (identity(current) !== identity(photo)) { current = photo; revision++; }
    armRotation();
  }
  function advance() {
    if (stopped || !pool.length) return;
    if (index + 1 >= sequence.length) { sequence = ordered(pool); index = -1; }
    select(sequence[++index]);
  }
  function accept(records) {
    const eligible = records.slice(0, 100).flatMap((record) => { try { return [validateSlideshowPhoto(record)]; } catch { return []; } });
    const changed = JSON.stringify(eligible) !== JSON.stringify(pool);
    pool = eligible; available = true; stale = false;
    if (!changed) return;
    const retained = pool.find((photo) => identity(photo) === identity(current));
    sequence = ordered(pool); index = retained ? sequence.findIndex((photo) => identity(photo) === identity(retained)) : -1;
    // A new random traversal retains the current selection, then visits all other members.
    if (retained && settings.order === 'random') { sequence = [retained, ...sequence.filter((photo) => identity(photo) !== identity(retained))]; index = 0; }
    if (!retained) select(sequence.length ? sequence[++index] : null);
    else if (pool.length < 2 || nextChangeAt === null) armRotation();
  }
  function refresh() {
    if (stopped || !started || !enabled || !settings || scanWork) return scanWork;
    loading = true;
    // Keep the actual filesystem promise owned until it settles, even after stop.
    scanWork = Promise.resolve().then(() => photoLibrary.list()).then((result) => {
      if (stopped) return;
      if (!result.available) { stale = available; return; }
      accept(result.photos);
    }).catch(() => { if (!stopped) stale = available; }).finally(() => {
      loading = false; scanWork = undefined;
      if (!stopped) scanTimer = schedule(() => { scanTimer = undefined; void refresh(); }, 60_000);
    });
    return scanWork;
  }
  function configure(next) {
    if (stopped) return;
    if (!next || !['name', 'date', 'random'].includes(next.order) || !Number.isInteger(next.interval) || next.interval < 5 || next.interval > 3600) throw new Error('Invalid slideshow preferences.');
    const previous = settings; settings = { order: next.order, interval: next.interval };
    if (!started) return;
    if (!previous) { void refresh(); return; }
    if (previous.order !== settings.order) { sequence = ordered(pool); index = -1; select(sequence.length ? sequence[++index] : null); }
    else if (previous.interval !== settings.interval) armRotation();
  }
  if (preferences) configure(preferences);
  return {
    start() { if (started || stopped) return; started = true; return refresh(); },
    configure,
    snapshot() { return validateSlideshowSnapshot({ version: 1, instanceId, revision, serverTime: now(), enabled, available, loading, stale, count: pool.length, current: current ? { ...current } : null, nextChangeAt }); },
    stop() {
      if (stopWork) return stopWork;
      stopped = true; cancel(scanTimer); cancel(rotationTimer); nextChangeAt = null;
      if (current) revision++;
      current = null; pool = []; sequence = []; available = false; stale = false; loading = false;
      stopWork = Promise.resolve(scanWork).then(() => {});
      return stopWork;
    }
  };
}
