import { finite, normalizeLocation, text } from './dashboard-helpers.js';

export async function requestJson(url, { signal, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Provider unavailable');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('Invalid provider response');
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function searchLocations(query, options) {
  const name = text(query);
  if (name.length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, count: '10', language: 'en', format: 'json' });
  const data = await requestJson(url, options);
  if (data.results !== undefined && !Array.isArray(data.results)) throw new Error('Invalid locations');
  return (data.results ?? []).slice(0, 10).map((row) => normalizeLocation({ ...row, label: [text(row?.name), text(row?.admin1), text(row?.country)].filter(Boolean).join(', ') })).filter(Boolean);
}

export function weatherUrls(settings) {
  const common = { latitude: settings.location.latitude, longitude: settings.location.longitude, timezone: settings.timezone, timeformat: 'unixtime' };
  const forecast = new URL('https://api.open-meteo.com/v1/forecast');
  forecast.search = new URLSearchParams({ ...common, temperature_unit: settings.temperature, wind_speed_unit: settings.wind, precipitation_unit: settings.precipitation, forecast_days: 7, current: 'temperature_2m,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m', hourly: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min' });
  const air = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  air.search = new URLSearchParams({ ...common, current: 'us_aqi' });
  return { forecast, air };
}

const value = (input) => finite(input) ? input : null;
const timestamp = (input) => finite(input) && input >= 0 && input < 8640000000000;
export function normalizeForecast(data) {
  if (!timestamp(data?.current?.time) || !finite(data.current.temperature_2m)) throw new Error('Invalid forecast');
  const fields = ['temperature_2m', 'relative_humidity_2m', 'is_day', 'precipitation', 'weather_code', 'wind_speed_10m'];
  const current = Object.fromEntries(fields.map((key) => [key, value(data.current[key])]));
  const units = Object.fromEntries(fields.map((key) => [key, text(data.current_units?.[key], 24)]));
  const hourly = (Array.isArray(data.hourly?.time) ? data.hourly.time : []).slice(0, 192).flatMap((time, i) => timestamp(time) && finite(data.hourly.temperature_2m?.[i]) ? [{ time, temperature: data.hourly.temperature_2m[i], code: value(data.hourly.weather_code?.[i]) }] : []).sort((a, b) => a.time - b.time);
  // Open-Meteo daily epoch values need its UTC offset reapplied for the calendar date.
  const offset = finite(data.utc_offset_seconds) && Math.abs(data.utc_offset_seconds) <= 86400 ? data.utc_offset_seconds : 0;
  const daily = (Array.isArray(data.daily?.time) ? data.daily.time : []).slice(0, 7).flatMap((time, i) => timestamp(time) ? [{ date: new Date((time + offset) * 1000).toISOString().slice(0, 10), min: value(data.daily.temperature_2m_min?.[i]), max: value(data.daily.temperature_2m_max?.[i]), code: value(data.daily.weather_code?.[i]) }] : []);
  return { current, units, hourly, daily, hourlyUnit: text(data.hourly_units?.temperature_2m, 24), dailyUnit: text(data.daily_units?.temperature_2m_max, 24) };
}

export function normalizeAir(data) {
  if (!finite(data?.current?.us_aqi)) throw new Error('Invalid air quality');
  return { aqi: data.current.us_aqi };
}

// One owner for refresh timers, requests and same-settings stale data.
export function createWeatherController({ onChange, fetchImpl = fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 10000 }) {
  let settings; let key; let generation = 0; let timer; let controller; let visible = true;
  let state = { forecast: null, air: null };
  function stop() { generation++; cancel(timer); timer = undefined; controller?.abort(); }
  async function refresh() {
    stop();
    if (!visible || !settings?.location || !settings.weatherVisible) return;
    const request = generation; controller = new AbortController();
    const options = { fetchImpl, signal: controller.signal, timeoutMs };
    onChange({ ...state, loading: true });
    const urls = weatherUrls(settings);
    await Promise.all(Object.entries(urls).map(async ([part, url]) => {
      try {
        const raw = await requestJson(url, options);
        const data = part === 'forecast' ? normalizeForecast(raw) : normalizeAir(raw);
        if (request !== generation) return;
        state = { ...state, [part]: data, [`${part}Error`]: false, [`${part}Updated`]: now() };
      } catch {
        if (request !== generation) return;
        state = { ...state, [`${part}Error`]: true };
      }
      onChange({ ...state, loading: true });
    }));
    if (request !== generation) return;
    onChange({ ...state, loading: false });
    timer = schedule(refresh, 3600000);
  }
  return {
    configure(next) {
      const nextKey = JSON.stringify([next.location, next.temperature, next.wind, next.precipitation, next.timezone, next.weatherVisible]);
      settings = next;
      if (key === nextKey) return;
      key = nextKey; stop(); state = { forecast: null, air: null }; onChange(state); void refresh();
    },
    setVisible(next) { if (visible === next) return; visible = next; if (visible) void refresh(); else stop(); },
    refresh,
    dispose: stop
  };
}
