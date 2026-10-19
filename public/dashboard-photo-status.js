import { requestDashboardJson } from './dashboard-request.js';
import { MAX_SLIDESHOW_BYTES, validatePhotoLibraryStatus } from './photo-slideshow-data.js';

export function formatPhotoLibraryStatus(status) {
  if (!status.enabled) return 'Image file count: unknown. NFS backgrounds are disabled.';
  let message = status.counts ? `Global playable image files: ${status.counts.eligible}.` : 'Image file count: unknown.';
  if (status.counts) {
    const counts = status.counts;
    if (counts.supported !== counts.eligible) message += ` Supported files: ${counts.supported}; excluded filenames: ${counts.filenameExcluded}.`;
    if (counts.permissionExcluded) message += ` Permission-denied files excluded: ${counts.permissionExcluded}.`;
    if (counts.raceExcluded) message += ` Vanished or changed files skipped: ${counts.raceExcluded}.`;
  }
  if (status.error) message += ` ${status.counts ? 'Last completed count is stale.' : 'Discovery is incomplete.'} ${status.error === 'resource-limit' ? 'Metadata resource limit reached.' : 'Photo scan failed.'} Retrying automatically.`;
  if (status.loading) message += ` Scanning image files… ${status.progress} entries examined.`;
  else if (!status.available && !status.error) message += ' Photo source unavailable or awaiting discovery.';
  return message;
}

export function createPhotoStatusController({ report, fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout }) {
  let visible = false; let disposed = false; let controller; let timer; let last;
  async function load() {
    if (!visible || disposed || controller) return;
    const owner = new AbortController(); controller = owner;
    try {
      const next = validatePhotoLibraryStatus(await requestDashboardJson('/api/dashboard/photos/status', { fetchImpl, signal: owner.signal, schedule, cancel, maxBytes: MAX_SLIDESHOW_BYTES }));
      if (owner.signal.aborted || !visible || disposed) return;
      last = next; report(formatPhotoLibraryStatus(next));
    } catch {
      if (!owner.signal.aborted && visible && !disposed) report(`${last ? formatPhotoLibraryStatus(last) : 'Image file count: unknown.'} Inventory status unavailable; any previous count may be stale. Retrying automatically.`);
    } finally {
      if (controller === owner) {
        controller = undefined;
        if (visible && !disposed) timer = schedule(() => { timer = undefined; void load(); }, 5000);
      }
    }
  }
  function pause() { cancel(timer); timer = undefined; controller?.abort(); controller = undefined; }
  return {
    setVisible(next) { if (disposed || visible === next) return; visible = next; pause(); if (visible) void load(); },
    dispose() { disposed = true; visible = false; pause(); }
  };
}
