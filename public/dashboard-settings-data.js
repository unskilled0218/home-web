import { validateDashboardPreferences } from './dashboard-helpers.js';
import { validateWeatherLocation } from './weather-data.js';

export const SCOPE_KEY = 'dashboard.settings-scope.v1';
export const LOCAL_SETTINGS_KEY = 'dashboard.local-settings.v1';
export const MAX_SETTINGS_TRANSFER_BYTES = 131072;
export const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const exactFields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const nullableWeatherLocation = value => value === null ? null : validateWeatherLocation(value);

export function parseSettingsJson(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_SETTINGS_TRANSFER_BYTES) throw new Error('Settings file is too large.');
  return JSON.parse(raw);
}
export function validateScope(value) {
  if (!exactFields(value, ['schema', 'mode']) || value.schema !== 1 || !['local', 'global'].includes(value.mode)) throw new Error('Invalid settings scope.');
  return value.mode;
}
export function validateLocalSettings(value) {
  const keys = ['schema', 'revision', 'preferences', 'weatherLocation'];
  const hasFollow = value && Object.hasOwn(value, 'followGlobalPhotos');
  if (!exactFields(value, hasFollow ? [...keys, 'followGlobalPhotos'] : keys) || value.schema !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || jsonBytes(value) > MAX_SETTINGS_TRANSFER_BYTES || (hasFollow && typeof value.followGlobalPhotos !== 'boolean')) throw new Error('Invalid local settings.');
  return { schema: 1, revision: value.revision, preferences: validateDashboardPreferences(value.preferences), weatherLocation: nullableWeatherLocation(value.weatherLocation), followGlobalPhotos: hasFollow ? value.followGlobalPhotos : true };
}
export function validateSettingsTransfer(value) {
  if (!exactFields(value, ['format', 'version', 'preferences', 'weatherLocation']) || value.format !== 'home-web.global-settings' || value.version !== 1 || jsonBytes(value) > MAX_SETTINGS_TRANSFER_BYTES || jsonBytes(value.preferences) > 65536) throw new Error('Invalid global settings file.');
  return { format: value.format, version: 1, preferences: validateDashboardPreferences(value.preferences), weatherLocation: nullableWeatherLocation(value.weatherLocation) };
}

export function validateConfigurationMetadata(value) {
  if (!exactFields(value, ['calendar', 'linkwarden'])) throw new Error('Invalid integration metadata.');
  for (const name of ['calendar', 'linkwarden']) {
    const item = value[name];
    if (!item || typeof item.available !== 'boolean') throw new Error('Invalid integration availability.');
    if (item.available && (typeof item.configured !== 'boolean' || item.configurationId !== null && (typeof item.configurationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(item.configurationId)))) throw new Error('Invalid integration identity.');
  }
  return value;
}
