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
  const abort = () => { image.src = ''; };
  signal.addEventListener('abort', abort, { once: true });
  image.src = url;
  return image.decode().finally(() => signal.removeEventListener('abort', abort));
}

export function createPhotoController({ show, clear, report, update = () => {}, fetchImpl = fetch, decode = decodeImage, schedule = setTimeout, cancel = clearTimeout, requestSchedule = setTimeout, requestCancel = clearTimeout }) {
  let settings; let visible = true; let disposed = false; let started = false; let epoch = 0; let timer; let read; let decoding;
  let snapshot; let desired; let displayed; const retired = new Set();
  const photoKey = (photo) => photo ? JSON.stringify(photo) : null;
  const displayPhoto = (photo) => ({ file: { name: photo.name, lastModified: photo.lastModified }, url: photo.url });
  function retireDecode() { decoding?.abort(); decoding = undefined; }
  function pause() { epoch++; cancel(timer); timer = undefined; read?.controller.abort(); read = undefined; retireDecode(); }
  function arm(delay = 5000) {
    cancel(timer); timer = undefined;
    if (visible && !disposed && started) timer = schedule(() => { timer = undefined; void load(); }, delay);
  }
  function render(photo) {
    const key = photoKey(photo);
    if ((displayed && photoKey(displayed) === key) || decoding?.key === key) return;
    retireDecode(); const controller = new AbortController(); controller.key = key; decoding = controller;
    let deadline;
    const aborted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Image decode canceled.')), { once: true }));
    deadline = requestSchedule(() => controller.abort(), 10_000);
    void Promise.race([Promise.resolve().then(() => decode(photo.url, { signal: controller.signal })), aborted]).then(() => {
      if (disposed || !visible || desired !== key || controller.signal.aborted) return;
      displayed = photo; show(displayPhoto(photo), settings);
    }).catch(() => {
      if (!disposed && visible && desired === key) report('The selected background could not be displayed. Retrying automatically.');
    }).finally(() => { requestCancel(deadline); if (decoding === controller) decoding = undefined; });
  }
  function accept(next) {
    if (snapshot?.instanceId === next.instanceId) {
      if (next.revision < snapshot.revision) return;
      if (next.revision === snapshot.revision && photoKey(next.current) !== photoKey(snapshot.current)) return;
    } else if (snapshot) {
      if (retired.has(next.instanceId)) return;
      retired.add(snapshot.instanceId); if (retired.size > 16) retired.delete(retired.values().next().value);
    }
    snapshot = next;
    const key = photoKey(next.current);
    if (desired !== key) { desired = key; retireDecode(); }
    report(!next.enabled ? 'NFS backgrounds are disabled.' : next.stale ? 'NFS backgrounds are stale. Retrying automatically.' : next.loading && !next.current ? 'Loading NFS backgrounds…' : !next.available ? 'NFS backgrounds are unavailable. Retrying automatically.' : next.count ? `${next.count} NFS backgrounds loaded.` : 'No supported photos were found on the NFS share.');
    if (next.current) render(next.current);
    else if (!next.enabled || next.available && next.count === 0) { displayed = undefined; clear(); }
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
      const response = await fetchImpl('/api/dashboard/slideshow', { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('Canceled read.'); }
      return readSnapshot(response, controller.signal);
    }), aborted]).then((next) => {
      if (generation !== epoch || controller.signal.aborted) return;
      accept(next);
      if (!next.loading && !next.stale && next.nextChangeAt !== null) delay = Math.max(250, Math.min(5000, next.nextChangeAt - next.serverTime));
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
