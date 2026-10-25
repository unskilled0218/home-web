import { createPhotoController } from './dashboard-photos.js';
import { createLocalPhotoController } from './dashboard-local-photos.js';

export function createScopedPhotoController(options) {
  let owner; let source; let visible = true;
  return {
    configure(settings, mode = 'global', epoch = mode, followGlobalPhotos = true) {
      const independent = mode === 'local' && !followGlobalPhotos;
      const identity = JSON.stringify([epoch, independent]);
      if (source !== identity) { owner?.dispose(); source = identity; owner = (independent ? createLocalPhotoController : createPhotoController)(options); owner.setVisible(visible); owner.configure(settings); void owner.load(); }
      else owner.configure(settings);
    },
    load: () => owner?.load(),
    setVisible(next) { visible = next; owner?.setVisible(next); },
    dispose() { owner?.dispose(); owner = undefined; source = undefined; }
  };
}
