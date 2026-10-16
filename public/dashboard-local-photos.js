import { createPhotoController } from './dashboard-photos.js';
import { validateLocalPhotoManifest, MAX_LOCAL_PHOTO_MANIFEST_BYTES } from './photo-slideshow-data.js';
import { requestDashboardJson } from './dashboard-request.js';

export function createLocalPhotoController(options) {
  const { fetchImpl = fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, random = Math.random } = options;
  let settings; let visible = true; let disposed = false; let started = false; let controller; let refreshTimer; let rotationTimer;
  let pool = []; let sequence = []; let index = -1; let current = null; let revision = 0; let enabled = true; let available = false; let loading = false; let stale = false; let nextChangeAt = null;
  const key = photo => JSON.stringify(photo);
  const follower = createPhotoController({ ...options, autoPoll: false, fetchImpl: async () => Response.json({ version: 1, instanceId: 'local', revision, serverTime: now(), enabled, available, loading, stale, count: pool.length, current, nextChangeAt }) });
  function ordered() {
    const rows = [...pool];
    if (settings.order === 'random') {
      for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
      if (rows.length > 1 && key(rows[0]) === key(current)) [rows[0], rows[1]] = [rows[1], rows[0]];
    } else rows.sort((a, b) => (settings.order === 'date' ? a.lastModified - b.lastModified : 0) || a.name.localeCompare(b.name));
    return rows;
  }
  function arm() {
    cancel(rotationTimer); rotationTimer = undefined; nextChangeAt = null;
    if (pool.length < 2) return;
    nextChangeAt = now() + settings.interval * 1000;
    if (visible && !disposed) rotationTimer = schedule(() => { rotationTimer = undefined; if (++index >= sequence.length) { sequence = ordered(); index = 0; } select(sequence[index]); }, settings.interval * 1000);
  }
  function select(photo) { if (key(current) !== key(photo)) { current = photo; revision++; } arm(); void follower.load(); }
  async function load() {
    started = true; if (!settings || disposed || !visible || controller) return;
    cancel(refreshTimer); const owner = new AbortController(); controller = owner; loading = true;
    if (!current) options.report('Loading NFS backgrounds…');
    try {
      const manifest = validateLocalPhotoManifest(await requestDashboardJson('/api/dashboard/photos/local', { fetchImpl, signal: owner.signal, schedule, cancel, maxBytes: MAX_LOCAL_PHOTO_MANIFEST_BYTES }));
      if (disposed || owner.signal.aborted) return;
      enabled = manifest.enabled;
      if (!manifest.enabled || manifest.available) {
        available = manifest.available; stale = false;
        if (key(pool) !== key(manifest.photos)) {
          pool = manifest.photos; sequence = ordered(); index = sequence.findIndex(photo => key(photo) === key(current));
          if (index < 0) { index = sequence.length ? 0 : -1; select(sequence[0] ?? null); }
          else if (pool.length < 2 || nextChangeAt === null) arm();
        }
      } else stale = available;
    } catch { if (!owner.signal.aborted) stale = available; }
    finally {
      if (controller === owner) {
        controller = undefined; loading = false; await follower.load();
        if (!disposed && visible) refreshTimer = schedule(() => { refreshTimer = undefined; void load(); }, 60000);
      }
    }
  }
  return {
    load,
    configure(next) {
      const previous = settings; settings = next; follower.configure(next);
      if (previous?.order !== next.order && pool.length) { sequence = ordered(); index = 0; select(sequence[0]); }
      else if (previous && previous.interval !== next.interval) arm();
    },
    setVisible(next) {
      if (next === visible || disposed) return; visible = next; follower.setVisible(next);
      if (!next) { cancel(refreshTimer); cancel(rotationTimer); controller?.abort(); controller = undefined; loading = false; }
      else if (started) { arm(); void load(); }
    },
    dispose() { disposed = true; cancel(refreshTimer); cancel(rotationTimer); controller?.abort(); controller = undefined; follower.dispose(); }
  };
}
