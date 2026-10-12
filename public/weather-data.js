import { finite, normalizeLocation, text } from './dashboard-helpers.js';

export const WEATHER_FIELDS = ['temperature_2m', 'relative_humidity_2m', 'is_day', 'precipitation', 'weather_code', 'wind_speed_10m'];
export const validTimestamp = (value) => finite(value) && value >= 0 && value < 8640000000000000;
const nullableNumber = (value) => value === null || finite(value);
const numberOrNull = (value) => finite(value) ? value : null;

export function weatherTimezone(value = 'UTC') {
  if (typeof value !== 'string' || !value || value.length > 80) throw new Error('Weather timezone must be a valid IANA timezone.');
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new Error('Weather timezone must be a valid IANA timezone.'); }
}

export function validateWeatherLocation(value) {
  const location = normalizeLocation(value);
  if (!location || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 120 || Object.keys(value).some((key) => !['latitude', 'longitude', 'label'].includes(key))) throw new Error('Weather location requires valid coordinates and a label of at most 120 characters.');
  return location;
}

export function normalizeForecast(data) {
  if (!finite(data?.current?.time) || !validTimestamp(data.current.time * 1000) || !finite(data?.current?.temperature_2m)) throw new Error('Invalid forecast');
  const current = Object.fromEntries(WEATHER_FIELDS.map((key) => [key, numberOrNull(data.current[key])]));
  const units = Object.fromEntries(WEATHER_FIELDS.map((key) => [key, text(data.current_units?.[key], 24)]));
  const hourly = (Array.isArray(data.hourly?.time) ? data.hourly.time : []).slice(0, 192).flatMap((time, i) => {
    if (!validTimestamp(time * 1000) || !finite(time) || !finite(data.hourly.temperature_2m?.[i])) return [];
    const day = data.hourly.is_day?.[i];
    return [{ time, temperature: data.hourly.temperature_2m[i], code: numberOrNull(data.hourly.weather_code?.[i]), day: day === 0 || day === 1 ? day : null }];
  }).sort((a, b) => a.time - b.time);
  const offset = finite(data.utc_offset_seconds) && Math.abs(data.utc_offset_seconds) <= 86400 ? data.utc_offset_seconds : 0;
  const daily = (Array.isArray(data.daily?.time) ? data.daily.time : []).slice(0, 7).flatMap((time, i) => finite(time) && validTimestamp((time + offset) * 1000) ? [{ date: new Date((time + offset) * 1000).toISOString().slice(0, 10), min: numberOrNull(data.daily.temperature_2m_min?.[i]), max: numberOrNull(data.daily.temperature_2m_max?.[i]), code: numberOrNull(data.daily.weather_code?.[i]) }] : []);
  return { current, units, hourly, daily, hourlyUnit: text(data.hourly_units?.temperature_2m, 24), dailyUnit: text(data.daily_units?.temperature_2m_max, 24) };
}

export function normalizeAir(data) {
  if (!finite(data?.current?.us_aqi)) throw new Error('Invalid air quality');
  return { aqi: data.current.us_aqi };
}

export function validateForecast(data) {
  const validUnits = (units) => WEATHER_FIELDS.every((key) => typeof units?.[key] === 'string' && units[key].length <= 24);
  if (!finite(data?.current?.temperature_2m) || !WEATHER_FIELDS.every((key) => nullableNumber(data.current[key])) || !validUnits(data.units)) throw new Error('Invalid cached forecast');
  if (!Array.isArray(data.hourly) || data.hourly.length > 192 || !data.hourly.every((row) => finite(row?.time) && validTimestamp(row.time * 1000) && finite(row.temperature) && nullableNumber(row.code) && [0, 1, null].includes(row.day))) throw new Error('Invalid cached hourly forecast');
  if (!Array.isArray(data.daily) || data.daily.length > 7 || !data.daily.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row?.date) && Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) && ['min', 'max', 'code'].every((key) => nullableNumber(row[key])))) throw new Error('Invalid cached daily forecast');
  if (![data.hourlyUnit, data.dailyUnit].every((unit) => typeof unit === 'string' && unit.length <= 24)) throw new Error('Invalid cached units');
  return data;
}

export function validateWeatherSnapshot(data) {
  if (!data || typeof data.configured !== 'boolean' || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('Invalid weather snapshot');
  const location = data.configured ? validateWeatherLocation(data.location) : null;
  if (!data.configured && data.location !== null) throw new Error('Invalid weather location');
  const timezone = weatherTimezone(data.timezone);
  for (const part of ['forecast', 'air']) {
    const payload = data[part]; const updated = data[`${part}Updated`];
    if (payload === null ? updated !== null : !validTimestamp(updated)) throw new Error('Invalid weather update time');
    if (payload !== null) {
      if (!data.configured) throw new Error('Unconfigured weather contains data');
      if (part === 'forecast') validateForecast(payload);
      else if (!finite(payload?.aqi)) throw new Error('Invalid cached air quality');
    }
  }
  if (!['forecastRegistered', 'forecastError', 'airError', 'refreshing'].every((key) => typeof data[key] === 'boolean')) throw new Error('Invalid weather status');
  return { ...data, location, timezone };
}

export function presentForecast(forecast, settings) {
  if (!forecast) return null;
  const round = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
  const temperature = (value) => value === null ? null : round(settings.temperature === 'fahrenheit' ? value * 9 / 5 + 32 : value);
  const windFactors = { kmh: 1, mph: 1 / 1.609344, ms: 1 / 3.6, kn: 1 / 1.852 };
  const temperatureUnit = settings.temperature === 'fahrenheit' ? '°F' : '°C';
  const current = { ...forecast.current, temperature_2m: temperature(forecast.current.temperature_2m), wind_speed_10m: forecast.current.wind_speed_10m === null ? null : round(forecast.current.wind_speed_10m * windFactors[settings.wind]), precipitation: forecast.current.precipitation === null ? null : round(forecast.current.precipitation / (settings.precipitation === 'inch' ? 25.4 : 1), 2) };
  return { ...forecast, current, units: { ...forecast.units, temperature_2m: temperatureUnit, wind_speed_10m: { kmh: 'km/h', mph: 'mph', ms: 'm/s', kn: 'kn' }[settings.wind], precipitation: settings.precipitation === 'inch' ? 'inch' : 'mm' }, hourly: forecast.hourly.map((row) => ({ ...row, temperature: temperature(row.temperature) })), daily: forecast.daily.map((row) => ({ ...row, min: temperature(row.min), max: temperature(row.max) })), hourlyUnit: temperatureUnit, dailyUnit: temperatureUnit };
}

export function formatWeatherUpdated(timestamp, settings, locale = undefined) {
  if (!validTimestamp(timestamp)) return '';
  return `Updated ${new Intl.DateTimeFormat(locale, { timeZone: settings.timezone, dateStyle: 'medium', timeStyle: 'short', hour12: settings.hour12 }).format(new Date(timestamp))}`;
}
