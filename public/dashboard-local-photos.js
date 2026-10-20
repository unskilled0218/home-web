import { createPhotoController } from './dashboard-photos.js';
import { validateLocalPhotoManifest, MAX_LOCAL_PHOTO_MANIFEST_BYTES } from './photo-slideshow-data.js';
import { requestDashboardJson } from './dashboard-request.js';
import { createPhotoBatchSequence } from './photo-batch-sequence.js';

export function createLocalPhotoController(options) {
  const { fetchImpl = fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, random = Math.random } = options;
  let settings; let visible = true; let disposed = false; let started = false; let controller; let refreshTimer; let rotationTimer;
  let pool = []; let current = null; let revision = 0; let enabled = true; let available = false; let loading = false; let stale = false; let nextChangeAt = null;
  let next = null; let queueRevision = 0; let delivery; let dirty = false; let generation = 0;
  const key = photo => JSON.stringify(photo);
  const follower = createPhotoController({ ...options, autoPoll: false, fetchImpl: async () => Response.json({ version: 2, instanceId: 'local', revision, queueRevision, next, serverTime: now(), enabled, available, loading, stale, count: pool.length, current, nextChangeAt }) });
  const batches = createPhotoBatchSequence({ random, yieldWork: options.yieldWork, schedule, cancel, onChange: preview });
  function notify() {
    if (disposed || !visible) return;
    dirty = true;
    if (delivery) return;
    const epoch = generation;
    delivery = Promise.resolve().then(async () => {
      while (dirty && !disposed && visible && epoch === generation) { dirty = false; await follower.load(); }
    }).finally(() => { delivery = undefined; if (dirty && !disposed && visible) notify(); });
  }
  function preview() {
    const candidate = pool.length > 1 ? batches.peek() : null;
    const upcoming = candidate?.name !== current?.name ? candidate : null;
    if (key(upcoming) !== key(next)) { next = upcoming; queueRevision++; notify(); }
  }
  function arm() {
    cancel(rotationTimer); rotationTimer = undefined; nextChangeAt = null;
    if (pool.length < 2) return;
    nextChangeAt = now() + settings.interval * 1000;
    if (visible && !disposed) rotationTimer = schedule(advance, settings.interval * 1000);
  }
  function advance() {
    rotationTimer = undefined; const photo = batches.commit();
    if (photo) select(photo);
    else if (visible && !disposed) { nextChangeAt = now() + 5000; rotationTimer = schedule(advance, 5000); }
  }
  function select(photo) { if (key(current) !== key(photo)) { current = photo; revision++; } arm(); preview(); notify(); }
  async function load() {
    started = true; if (!settings || disposed || !visible || controller) return;
    cancel(refreshTimer); const epoch = generation; const owner = new AbortController(); controller = owner; loading = true;
    if (!current) options.report('Loading NFS backgrounds…');
    try {
      const manifest = validateLocalPhotoManifest(await requestDashboardJson('/api/dashboard/photos/local', { fetchImpl, signal: owner.signal, schedule, cancel, maxBytes: MAX_LOCAL_PHOTO_MANIFEST_BYTES }));
      if (disposed || owner.signal.aborted) return;
      enabled = manifest.enabled;
      if (!manifest.enabled || manifest.available) {
        available = manifest.available; stale = false;
        if (key(pool) !== key(manifest.photos)) {
          pool = manifest.photos; batches.reconcile(pool); const retained = batches.get(current?.name);
          if (!retained) select(pool.length ? batches.commit({ replacement: true }) : null);
          else { if (key(current) !== key(retained)) { current = retained; revision++; } if (pool.length < 2 || nextChangeAt === null) arm(); }
          preview();
        }
      } else stale = available;
    } catch { if (!owner.signal.aborted) stale = available; }
    finally {
      if (controller === owner) {
        controller = undefined; loading = false; notify(); await delivery;
        if (!disposed && visible && epoch === generation) { cancel(refreshTimer); refreshTimer = schedule(() => { refreshTimer = undefined; void load(); }, 60000); }
      }
    }
  }
  return {
    load,
    configure(next) {
      const previous = settings; settings = next; follower.configure(next);
      batches.configure(next);
      if (previous?.order !== next.order && pool.length) select(batches.commit());
      else if (previous && previous.interval !== next.interval) arm();
    },
    setVisible(next) {
      if (next === visible || disposed) return; visible = next; follower.setVisible(next);
      if (!next) { generation++; dirty = false; cancel(refreshTimer); cancel(rotationTimer); controller?.abort(); controller = undefined; loading = false; }
      else if (started) { arm(); notify(); void load(); }
    },
    dispose() { disposed = true; generation++; dirty = false; cancel(refreshTimer); cancel(rotationTimer); controller?.abort(); controller = undefined; follower.dispose(); return Promise.all([batches.stop(), delivery]).then(() => {}); }
  };
}
