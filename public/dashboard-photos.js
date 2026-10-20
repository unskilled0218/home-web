import { MAX_SLIDESHOW_BYTES, validateSlideshowSnapshot } from './photo-slideshow-data.js';

async function readSnapshot(response, signal) {
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('Slideshow unavailable.'); }
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error('Slideshow read canceled.');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SLIDESHOW_BYTES) throw new Error('Slideshow response too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return validateSlideshowSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
}

function decodeImage(url, { signal }) {
  if (signal.aborted) return Promise.reject(new Error('Image decode canceled.'));
  const image = new Image();
  const abort = () => { image.removeAttribute('src'); };
  signal.addEventListener('abort', abort, { once: true });
  image.src = url;
  return image.decode().then(() => ({ image, release() { image.removeAttribute('src'); } })).catch(error => { image.removeAttribute('src'); throw error; }).finally(() => signal.removeEventListener('abort', abort));
}

export function createPhotoController({ show, clear, report, update = () => {}, fetchImpl = fetch, decode = decodeImage, schedule = setTimeout, cancel = clearTimeout, requestSchedule = setTimeout, requestCancel = clearTimeout, autoPoll = true }) {
  let settings; let visible = true; let disposed = false; let started = false; let epoch = 0; let timer; let retryTimer; let read; let decoding;
  let snapshot; let desired; let displayed; let ready; const retired = new Set();
  const photoKey = (photo) => photo ? JSON.stringify(photo) : null;
  const displayPhoto = (photo, resource) => ({ file: { name: photo.name, lastModified: photo.lastModified }, url: photo.url, ...(resource ? { resource } : {}) });
  function releaseReady() { ready?.resource?.release(); ready = undefined; }
  function retireDecode() { cancel(retryTimer); retryTimer = undefined; decoding?.abort(); decoding = undefined; }
  function pause() { epoch++; cancel(timer); timer = undefined; read?.controller.abort(); read = undefined; retireDecode(); releaseReady(); }
  function arm(delay = 5000) {
    cancel(timer); timer = undefined;
    if (autoPoll && visible && !disposed && started) timer = schedule(() => { timer = undefined; void load(); }, delay);
  }
  function reportSource(next) {
    report(!next.enabled ? 'NFS backgrounds are disabled.' : next.stale ? 'NFS backgrounds are stale. Retrying automatically.' : next.loading && !next.current ? 'Loading NFS backgrounds…' : !next.available ? 'NFS backgrounds are unavailable. Retrying automatically.' : next.count ? `Using ${next.count} NFS background${next.count === 1 ? '' : 's'} in this playback sequence.` : 'No eligible photos were found in the completed inventory.');
  }
  function promote(photo, resource) { displayed = photo; show(displayPhoto(photo, resource), settings); reportSource(snapshot); }
  function pump() {
    if (disposed || !visible || !snapshot?.current) return;
    const currentKey = photoKey(snapshot.current); const nextKey = photoKey(snapshot.next);
    if (ready && ready.key !== currentKey && ready.key !== nextKey) releaseReady();
    if (ready?.key === currentKey) { const resource = ready.resource; ready = undefined; promote(snapshot.current, resource); }
    const photo = photoKey(displayed) !== currentKey ? snapshot.current : snapshot.next;
    if (!photo) { if (decoding) retireDecode(); return; }
    if (ready?.key === photoKey(photo) || retryTimer) return;
    render(photo);
  }
  function render(photo) {
    const key = photoKey(photo);
    if ((displayed && photoKey(displayed) === key) || decoding?.key === key) return;
    retireDecode(); const controller = new AbortController(); controller.key = key; decoding = controller;
    let deadline;
    const aborted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Image decode canceled.')), { once: true }));
    deadline = requestSchedule(() => controller.abort(), 10_000);
    const work = Promise.resolve().then(() => decode(photo.url, { signal: controller.signal })).then(resource => {
      if (controller.signal.aborted) resource?.release();
      return resource;
    });
    void Promise.race([work, aborted]).then((resource) => {
      if (disposed || !visible || controller.signal.aborted || key !== desired && key !== photoKey(snapshot?.next)) { resource?.release(); return; }
      if (key === desired) promote(snapshot.current, resource);
      else { releaseReady(); ready = { key, resource }; }
    }).catch(() => {
      if (!disposed && visible && (desired === key || photoKey(snapshot?.next) === key) && decoding === controller) {
        if (desired === key) report('The selected background could not be displayed. Retrying automatically.');
        // Image recovery must not depend on metadata polling or Local rotation.
        retryTimer = schedule(() => { retryTimer = undefined; pump(); }, 5000);
      }
    }).finally(() => { requestCancel(deadline); if (decoding === controller) { decoding = undefined; if (!retryTimer) pump(); } });
  }
  function accept(next) {
    if (snapshot?.instanceId === next.instanceId) {
      if (next.revision < snapshot.revision) return;
      if (next.revision === snapshot.revision && photoKey(next.current) !== photoKey(snapshot.current)) return;
      if (next.version === 2 && snapshot.version === 2 && (next.queueRevision < snapshot.queueRevision || next.queueRevision === snapshot.queueRevision && photoKey(next.next) !== photoKey(snapshot.next))) return;
    } else if (snapshot) {
      if (retired.has(next.instanceId)) return;
      retired.add(snapshot.instanceId); if (retired.size > 16) retired.delete(retired.values().next().value);
      retireDecode(); releaseReady();
    }
    if (photoKey(snapshot?.next) !== photoKey(next.next) && photoKey(displayed) === photoKey(next.current)) { cancel(retryTimer); retryTimer = undefined; }
    snapshot = next;
    const key = photoKey(next.current);
    if (desired !== key) { desired = key; cancel(retryTimer); retryTimer = undefined; if (decoding?.key !== key) retireDecode(); }
    if (decoding && decoding.key !== key && decoding.key !== photoKey(next.next)) retireDecode();
    reportSource(next);
    if (next.current) pump();
    else if (!next.enabled || next.available && next.count === 0) { releaseReady(); displayed = undefined; clear(); }
  }
  function load() {
    started = true;
    if (!settings || disposed || !visible) return Promise.resolve();
    if (read) return read.work;
    cancel(timer); timer = undefined;
    const generation = epoch; const controller = new AbortController(); const owner = { controller }; read = owner;
    const aborted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Slideshow read canceled.')), { once: true }));
    const deadline = requestSchedule(() => controller.abort(), 10_000);
    let delay = 5000;
    owner.work = Promise.race([Promise.resolve().then(async () => {
      const response = await fetchImpl('/api/dashboard/slideshow?version=2', { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('Canceled read.'); }
      return readSnapshot(response, controller.signal);
    }), aborted]).then((next) => {
      if (generation !== epoch || controller.signal.aborted) return;
      accept(next);
      if (!next.loading && !next.stale && next.nextChangeAt !== null) delay = Math.max(250, Math.min(5000, next.nextChangeAt - next.serverTime));
      if (next.version === 2 && next.enabled && next.available && next.count > 1 && next.next === null) delay = Math.min(500, delay);
    }).catch(() => { if (generation === epoch && !disposed) report('NFS backgrounds are unavailable. Retrying automatically.'); }).finally(() => {
      requestCancel(deadline);
      if (read === owner) { read = undefined; arm(delay); }
    });
    return owner.work;
  }
  return {
    load,
    configure(next) {
      const changed = !settings || ['duration', 'animation', 'opacity', 'background', 'color', 'blur', 'imageInfo'].some((key) => settings[key] !== next[key]);
      settings = next; if (displayed && changed) update(displayPhoto(displayed), settings);
    },
    setVisible(next) { if (visible === next || disposed) return; visible = next; if (!next) pause(); else if (started) void load(); },
    dispose() { disposed = true; pause(); displayed = undefined; clear(); }
  };
}
