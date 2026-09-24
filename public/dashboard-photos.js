import { orderPhotos, selectPhotos } from './dashboard-helpers.js';

export function createPhotoController({ show, clear, report, createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL, decode = async (url) => { const image = new Image(); image.src = url; await image.decode(); }, schedule = setTimeout, cancel = clearTimeout }) {
  let photos = []; let ordered = []; let settings; let index = 0; let timer; let generation = 0; let visible = true;
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
    select(files) {
      stop(); clear(); photos.forEach((photo) => revokeUrl(photo.url));
      const { accepted, excluded } = selectPhotos(files);
      photos = accepted.map((file) => ({ file, url: createUrl(file) }));
      ordered = orderPhotos(photos, settings.order); index = 0;
      report(`${photos.length} photos selected; ${excluded} excluded. Photos must be reselected after reload.`);
      restart();
    },
    configure(next) { settings = next; ordered = orderPhotos(photos, next.order); index = 0; restart(); },
    setVisible(next) { if (visible === next) return; visible = next; restart(); },
    dispose() { stop(); clear(); photos.forEach((photo) => revokeUrl(photo.url)); photos = []; ordered = []; }
  };
}
