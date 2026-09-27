import { orderPhotos } from './dashboard-helpers.js';

export function createPhotoController({ show, clear, report, fetchImpl = fetch, decode = async (url) => { const image = new Image(); image.src = url; await image.decode(); }, schedule = setTimeout, cancel = clearTimeout, requestSchedule = setTimeout, requestCancel = clearTimeout }) {
  let photos = []; let ordered = []; let settings; let index = 0; let timer; let generation = 0; let loadGeneration = 0; let controller; let visible = true;
  function stop() { generation++; cancel(timer); timer = undefined; }
  async function advance() {
    const request = generation;
    while (ordered.length) {
      const photo = ordered[index % ordered.length];
      try { await decode(photo.url); } catch {
        if (request !== generation) return;
        ordered = ordered.filter((item) => item !== photo);
        report(`Could not display ${photo.file.name}. Skipping this image.`);
        continue;
      }
      if (request !== generation) return;
      show(photo, settings);
      index = (index + 1) % ordered.length;
      if (visible && ordered.length > 1) timer = schedule(() => { void advance(); }, settings.interval * 1000);
      return;
    }
    clear();
  }
  function restart() { stop(); if (settings && visible) void advance(); }
  return {
    async load() {
      const request = ++loadGeneration;
      controller?.abort(); controller = new AbortController();
      const loadController = controller;
      let timedOut = false;
      const deadline = requestSchedule(() => { timedOut = true; loadController.abort(); }, 10_000);
      report('Loading NFS backgrounds…');
      try {
        const response = await fetchImpl('/api/dashboard/photos', { signal: loadController.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('request failed');
        const body = await response.json();
        if (request !== loadGeneration) return;
        const records = Array.isArray(body?.photos) ? body.photos : [];
        photos = records.slice(0, 100).flatMap((photo) => typeof photo?.name === 'string' && photo.name.length <= 1024 && Number.isFinite(photo.lastModified) && /^\/api\/dashboard\/photos\/[A-Za-z0-9_-]{16,128}$/.test(photo.url) ? [{ file: { name: photo.name, lastModified: photo.lastModified }, url: photo.url }] : []);
        stop(); clear();
        ordered = orderPhotos(photos, settings.order); index = 0;
        report(!body?.available ? 'NFS backgrounds are unavailable. The dashboard will continue without photos.' : photos.length ? `${photos.length} NFS backgrounds loaded.` : 'No supported photos were found on the NFS share.');
        restart();
      } catch (error) {
        if (request !== loadGeneration || (error?.name === 'AbortError' && !timedOut)) return;
        stop(); clear(); photos = []; ordered = [];
        report('NFS backgrounds could not be loaded. The dashboard will continue without photos.');
      } finally { requestCancel(deadline); if (controller === loadController) controller = undefined; }
    },
    replace(records) {
      stop(); clear();
      photos = records;
      ordered = orderPhotos(photos, settings.order); index = 0;
      restart();
    },
    configure(next) { settings = next; ordered = orderPhotos(photos, next.order); index = 0; restart(); },
    setVisible(next) { if (visible === next) return; visible = next; restart(); },
    dispose() { loadGeneration++; controller?.abort(); stop(); clear(); photos = []; ordered = []; }
  };
}
