export const SETTINGS_KEY = 'dashboard.preferences.v1';
export const MOBILE_MEDIA_QUERY = '(max-width: 600px)';
const choice = (value, options, fallback) => options.includes(value) ? value : fallback;
const number = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const mobileScale = (value) => Math.round(number(value, 0.5, 2, 1) * 10) / 10;
export const text = (value, limit = 120) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export const finite = (value) => typeof value === 'number' && Number.isFinite(value);

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
    timezone, dateStyle: choice(value.dateStyle, ['short', 'medium', 'long', 'full'], 'medium'), hour12: boolean(value.hour12, false), seconds: boolean(value.seconds, true),
    timeVisible: boolean(value.timeVisible, true), timeScale: number(value.timeScale, 0.5, 2, 1), weatherVisible: boolean(value.weatherVisible, true), weatherScale: number(value.weatherScale, 0.5, 2, 1), calendarVisible: boolean(value.calendarVisible, true), calendarScale: number(value.calendarScale, 0.5, 2, 1),
    mobileTimeVisible: boolean(value.mobileTimeVisible, true), mobileTimeScale: mobileScale(value.mobileTimeScale), mobileWeatherVisible: boolean(value.mobileWeatherVisible, true), mobileWeatherScale: mobileScale(value.mobileWeatherScale), mobileCalendarVisible: boolean(value.mobileCalendarVisible, true), mobileCalendarScale: mobileScale(value.mobileCalendarScale),
    mobileBookmarksMode: choice(value.mobileBookmarksMode, ['compact', 'expanded'], 'compact'), hideBookmarksFullscreen: boolean(value.hideBookmarksFullscreen, false),
    location: normalizeLocation(value.location), temperature: choice(value.temperature, ['celsius', 'fahrenheit'], 'celsius'), wind: choice(value.wind, ['kmh', 'mph', 'ms', 'kn'], 'kmh'), precipitation: choice(value.precipitation, ['mm', 'inch'], 'mm'),
    order: choice(value.order, ['name', 'date', 'random'], 'random'), interval, duration: number(value.duration, 0, Math.min(10, interval - 1), 3), animation: choice(value.animation, ['none', 'fade', 'slide'], 'fade'),
    opacity: number(value.opacity, 0, 1, 1), background: choice(value.background, ['color', 'blur'], 'color'), color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#000000', blur: number(value.blur, 0, 100, 100), imageInfo: boolean(value.imageInfo, false)
  };
}

export function loadSettings(storage) {
  try { return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY))); } catch { return normalizeSettings(); }
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
    calendarScale: mobile ? settings.mobileCalendarScale : settings.calendarScale
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
