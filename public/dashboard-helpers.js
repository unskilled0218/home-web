import { normalizeBookmarkSelections } from './bookmark-selection-data.js';
import { defaultWidgetLayout, normalizeWidgetLayout, decodeStoredWidgetLayout } from './dashboard-layout.js';

export const SETTINGS_KEY = 'dashboard.preferences.v1';
export const MOBILE_MEDIA_QUERY = '(max-width: 600px)';
const choice = (value, options, fallback) => options.includes(value) ? value : fallback;
const number = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const mobileScale = (value) => Math.round(number(value, 0.5, 2, 1) * 10) / 10;
export const text = (value, limit = 120) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export const finite = (value) => typeof value === 'number' && Number.isFinite(value);
export const MAX_HOME_ASSISTANT_SELECTIONS = 256;
export const DEVICE_SELECTION_ID = /^d_[A-Za-z0-9_-]{43}$/;
export const preferencesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function normalizeDeviceSelections(value = []) {
  if (!Array.isArray(value) || value.length > MAX_HOME_ASSISTANT_SELECTIONS || value.some((id) => typeof id !== 'string' || !DEVICE_SELECTION_ID.test(id)) || new Set(value).size !== value.length) throw new Error('Invalid Home Assistant device selections. Select at most 256 unique devices.');
  return [...value].sort();
}

export function temperatureRange(minimum, maximum, unit = '') {
  const compact = (value) => value === null || value === undefined ? 'Unavailable' : `${value}${unit}`;
  return `${compact(minimum)}/${compact(maximum)}`;
}

export function normalizeLocation(value) {
  if (!value || !finite(value.latitude) || !finite(value.longitude) || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return null;
  return { latitude: value.latitude, longitude: value.longitude, label: text(value.label) || 'Selected location' };
}

export function normalizeSettings(input = {}, fallbackZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const value = input && typeof input === 'object' ? input : {};
  let timezone = text(value.timezone, 80) || fallbackZone;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { timezone = fallbackZone; }
  const interval = number(value.interval, 5, 3600, 60);
  return {
    position: choice(value.position, ['left', 'right'], 'left'), scale: number(value.scale, 0.5, 2, 1),
    widgetLayout: Object.hasOwn(value, 'widgetLayout') ? normalizeWidgetLayout(value.widgetLayout) : defaultWidgetLayout(),
    timezone, dateStyle: choice(value.dateStyle, ['short', 'medium', 'long', 'full'], 'medium'), hour12: boolean(value.hour12, false), seconds: boolean(value.seconds, true),
    timeVisible: boolean(value.timeVisible, true), timeScale: number(value.timeScale, 0.5, 2, 1), weatherVisible: boolean(value.weatherVisible, true), weatherScale: number(value.weatherScale, 0.5, 2, 1), calendarVisible: boolean(value.calendarVisible, true), calendarScale: number(value.calendarScale, 0.5, 2, 1),
    mobileTimeVisible: boolean(value.mobileTimeVisible, true), mobileTimeScale: mobileScale(value.mobileTimeScale), mobileWeatherVisible: boolean(value.mobileWeatherVisible, true), mobileWeatherScale: mobileScale(value.mobileWeatherScale), mobileCalendarVisible: boolean(value.mobileCalendarVisible, true), mobileCalendarScale: mobileScale(value.mobileCalendarScale),
    mobileBookmarksMode: choice(value.mobileBookmarksMode, ['compact', 'expanded'], 'compact'), hideBookmarksFullscreen: boolean(value.hideBookmarksFullscreen, false),
    bookmarksVisible: boolean(value.bookmarksVisible, true), homeAssistantVisible: boolean(value.homeAssistantVisible, true), wolVisible: boolean(value.wolVisible, true),
    mobileBookmarksVisible: boolean(value.mobileBookmarksVisible, true), mobileHomeAssistantVisible: boolean(value.mobileHomeAssistantVisible, true), mobileWolVisible: boolean(value.mobileWolVisible, true),
    homeAssistantDeviceSelections: normalizeDeviceSelections(value.homeAssistantDeviceSelections),
    bookmarkLinkSelections: normalizeBookmarkSelections(value.bookmarkLinkSelections),
    location: normalizeLocation(value.location), temperature: choice(value.temperature, ['celsius', 'fahrenheit'], 'celsius'), wind: choice(value.wind, ['kmh', 'mph', 'ms', 'kn'], 'kmh'), precipitation: choice(value.precipitation, ['mm', 'inch'], 'mm'),
    order: choice(value.order, ['name', 'date', 'random'], 'random'), interval, duration: number(value.duration, 0, Math.min(10, interval - 1), 3), animation: choice(value.animation, ['none', 'fade', 'slide'], 'fade'),
    opacity: number(value.opacity, 0, 1, 1), background: choice(value.background, ['color', 'blur'], 'color'), color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#000000', blur: number(value.blur, 0, 100, 100), imageInfo: boolean(value.imageInfo, false)
  };
}

export function loadSettings(storage) {
  try { return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY))); } catch { return normalizeSettings(); }
}

export const PREFERENCE_KEYS = Object.keys(normalizeSettings({}, 'UTC')).filter((key) => key !== 'location');
export function normalizeDashboardPreferences(input = {}) {
  const result = normalizeSettings(input, 'UTC'); delete result.location;
  for (const key of PREFERENCE_KEYS) if (typeof result[key] === 'number') result[key] = ['interval', 'blur'].includes(key) ? Math.round(result[key]) : Math.round(result[key] * 10) / 10;
  result.duration = Math.min(result.duration, 10, result.interval - 1);
  return result;
}
export function validateDashboardPreferences(value) {
  if (value && typeof value === 'object' && !Object.hasOwn(value, 'widgetLayout')) throw new Error('Dashboard preferences have changed. Reload this page before saving.');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== PREFERENCE_KEYS.length || Object.keys(value).some((key) => !PREFERENCE_KEYS.includes(key))) throw new Error('Invalid dashboard preference fields.');
  const canonical = normalizeDashboardPreferences(value);
  for (const key of PREFERENCE_KEYS) if (!['homeAssistantDeviceSelections', 'bookmarkLinkSelections', 'widgetLayout'].includes(key) && value[key] !== canonical[key]) throw new Error(`Invalid dashboard preference: ${key}.`);
  return canonical;
}
export function decodeStoredDashboardPreferences(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return validateDashboardPreferences({ homeAssistantDeviceSelections: [], bookmarkLinkSelections: null, bookmarksVisible: true, homeAssistantVisible: true, wolVisible: true, mobileBookmarksVisible: true, mobileHomeAssistantVisible: true, mobileWolVisible: true, ...value, widgetLayout: Object.hasOwn(value, 'widgetLayout') ? decodeStoredWidgetLayout(value.widgetLayout) : defaultWidgetLayout() });
  return validateDashboardPreferences(value);
}
export function legacyDashboardPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const defaults = normalizeDashboardPreferences();
  if (!PREFERENCE_KEYS.some((key) => Object.hasOwn(value, key) && typeof value[key] === typeof defaults[key] && (typeof value[key] !== 'number' || Number.isFinite(value[key])))) return null;
  try { return normalizeDashboardPreferences(Object.hasOwn(value, 'widgetLayout') ? { ...value, widgetLayout: decodeStoredWidgetLayout(value.widgetLayout) } : value); } catch { return null; }
}
export function validateDashboardSnapshot(value) {
  if (!value || typeof value.initialized !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.initialized !== (value.revision > 0)) throw new Error('Invalid shared settings revision.');
  const preferences = validateDashboardPreferences(value.preferences);
  if (!value.integrations || !['weather', 'calendar', 'linkwarden'].every((key) => typeof value.integrations[key]?.available === 'boolean')) throw new Error('Invalid shared integration metadata.');
  for (const key of ['calendar', 'linkwarden']) {
    const metadata = value.integrations[key];
    if (metadata.available && (typeof metadata.configured !== 'boolean' || (metadata.configurationId !== null && (typeof metadata.configurationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(metadata.configurationId))))) throw new Error('Invalid shared configuration identity.');
  }
  const weather = value.integrations.weather;
  if (weather.available && (!Number.isSafeInteger(weather.revision) || weather.revision < 0 || (weather.location !== null && !normalizeLocation(weather.location)))) throw new Error('Invalid shared weather location.');
  return { ...value, preferences };
}

// Projection changes presentation without replacing either saved profile.
export function resolveDisplayPreferences(settings, mobile) {
  return {
    position: mobile ? 'left' : settings.position,
    scale: mobile ? 1 : settings.scale,
    timeVisible: mobile ? settings.mobileTimeVisible : settings.timeVisible,
    timeScale: mobile ? settings.mobileTimeScale : settings.timeScale,
    weatherVisible: mobile ? settings.mobileWeatherVisible : settings.weatherVisible,
    weatherScale: mobile ? settings.mobileWeatherScale : settings.weatherScale,
    calendarVisible: mobile ? settings.mobileCalendarVisible : settings.calendarVisible,
    calendarScale: mobile ? settings.mobileCalendarScale : settings.calendarScale,
    bookmarksVisible: mobile ? settings.mobileBookmarksVisible : settings.bookmarksVisible,
    homeAssistantVisible: mobile ? settings.mobileHomeAssistantVisible : settings.homeAssistantVisible,
    wolVisible: mobile ? settings.mobileWolVisible : settings.wolVisible
  };
}

export function clockText(date, settings, locale = undefined) {
  return {
    date: new Intl.DateTimeFormat(locale, { timeZone: settings.timezone, dateStyle: settings.dateStyle }).format(date),
    time: new Intl.DateTimeFormat(locale, { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', ...(settings.seconds && { second: '2-digit' }), hour12: settings.hour12 }).format(date)
  };
}

export function orderPhotos(photos, order, random = Math.random) {
  const result = [...photos];
  if (order === 'random') {
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  } else result.sort((a, b) => (order === 'date' ? a.file.lastModified - b.file.lastModified : 0) || a.file.name.localeCompare(b.file.name));
  return result;
}

export function sampleHours(rows, now = Date.now()) {
  let next = now / 1000;
  return rows.filter((row) => { if (row.time < next || row.time > now / 1000 + 86400) return false; next = row.time + 10800; return true; }).slice(1, 8);
}

export function weatherDescription(code, day = 1) {
  if (code === 0) return day === 0 ? 'Clear night' : 'Clear sky';
  if ([1, 2, 3].includes(code)) return ['Mainly clear', 'Partly cloudy', 'Overcast'][code - 1];
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Conditions unavailable';
}

export function weatherIconFile(code, day = 1) {
  if (!Number.isFinite(code)) return 'weather-cloudy.svg';
  const night = day === 0;
  if (code === 0) return night ? 'weather-night.svg' : 'weather-sunny.svg';
  if ([1, 2].includes(code)) return night ? 'weather-night-partly-cloudy.svg' : 'weather-partly-cloudy.svg';
  if (code === 3) return 'weather-cloudy.svg';
  if ([45, 48].includes(code)) return 'weather-fog.svg';
  if ([51, 53, 55, 61, 63, 80, 81].includes(code)) return 'weather-rainy.svg';
  if ([65, 82].includes(code)) return 'weather-pouring.svg';
  if ([56, 57, 66, 67].includes(code)) return 'weather-snowy-rainy.svg';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'weather-snowy.svg';
  if (code === 95) return 'weather-lightning.svg';
  if ([96, 99].includes(code)) return 'weather-lightning-rainy.svg';
  return 'weather-cloudy.svg';
}
