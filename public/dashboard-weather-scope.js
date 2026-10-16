import { createWeatherController } from './dashboard-weather.js';
import { createLocalWeatherController } from './dashboard-local-weather.js';

export function createScopedWeatherController(options) {
  let owner; let source; let mode; let visible = true;
  return {
    configure(settings, nextMode = 'global', epoch = nextMode, location = null) {
      const changed = source !== epoch;
      if (changed) { owner?.dispose(); source = epoch; mode = nextMode; owner = (mode === 'local' ? createLocalWeatherController : createWeatherController)({ ...options, autoStart: false }); owner.setVisible(visible); }
      owner.configure(settings, location);
      if (changed && mode === 'global') void owner.refresh();
    },
    saveLocation(location) { return mode === 'local' ? options.saveLocalLocation(location) : owner.saveLocation(location); },
    captureConfigurationObserver() { return mode === 'global' ? owner?.captureConfigurationObserver() ?? (() => {}) : () => {}; },
    refresh: () => owner?.refresh(),
    getState: () => owner?.getState() ?? {},
    setVisible(next) { visible = next; owner?.setVisible(next); },
    dispose() { owner?.dispose(); source = undefined; owner = undefined; }
  };
}
