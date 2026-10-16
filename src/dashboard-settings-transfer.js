import { validateSettingsTransfer } from '../public/dashboard-settings-data.js';
import { sqliteTransaction } from './sqlite-transaction.js';

export function createSettingsTransfer(db, preferences, weather) {
  function read() {
    const saved = preferences.getDashboardPreferences(); const location = weather.getWeatherLocation();
    return { settings: validateSettingsTransfer({ format: 'home-web.global-settings', version: 1, preferences: saved.preferences, weatherLocation: location.location }), preferencesRevision: saved.revision, weatherRevision: location.revision };
  }
  return {
    exportDashboardSettings: () => sqliteTransaction(db, read),
    importDashboardSettings(value, preferencesRevision, weatherRevision) {
      const settings = validateSettingsTransfer(value);
      return sqliteTransaction(db, () => {
        const current = read(); if (current.preferencesRevision !== preferencesRevision || current.weatherRevision !== weatherRevision) return null;
        const saved = preferences.saveDashboardPreferences(settings.preferences, preferencesRevision);
        const location = weather.saveWeatherLocation(settings.weatherLocation, weatherRevision);
        if (!saved || !location) throw new Error('Settings changed during import.');
        return { ...read(), preferences: saved, weather: location };
      });
    }
  };
}
