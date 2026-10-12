import { normalizeAir, normalizeForecast, validateForecast, validTimestamp, weatherTimezone } from '../public/weather-data.js';

export const WEATHER_REFRESH_MS = 3600000;
const MAX_PROVIDER_BYTES = 1024 * 1024;

export function weatherUrls(location, timezone = 'UTC') {
  const common = { latitude: location.latitude, longitude: location.longitude, timezone, timeformat: 'unixtime' };
  const forecast = new URL('https://api.open-meteo.com/v1/forecast');
  forecast.search = new URLSearchParams({ ...common, temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm', forecast_days: 7, current: 'temperature_2m,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m', hourly: 'temperature_2m,weather_code,is_day', daily: 'weather_code,temperature_2m_max,temperature_2m_min' });
  const air = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  air.search = new URLSearchParams({ ...common, timezone: 'UTC', current: 'us_aqi' });
  return { forecast, air };
}

async function providerJson(url, signal, fetchImpl) {
  const response = await fetchImpl(url, { signal, redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_PROVIDER_BYTES) throw new Error('Weather provider unavailable');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PROVIDER_BYTES || signal.aborted) throw new Error('Weather response exceeds limits');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('Invalid weather provider response');
  return data;
}

async function retrieve(url, controller, options) {
  let timer; let abort;
  const interrupted = new Promise((_resolve, reject) => {
    abort = () => reject(new Error('Weather request canceled'));
    controller.signal.addEventListener('abort', abort, { once: true });
    timer = options.schedule(() => controller.abort(), options.timeoutMs);
  });
  try { return await Promise.race([providerJson(url, controller.signal, options.fetchImpl), interrupted]); }
  finally { options.cancel(timer); controller.signal.removeEventListener('abort', abort); }
}

function cachedPart(row) {
  if (!row?.payload || !validTimestamp(row.updated)) return null;
  try {
    const data = JSON.parse(row.payload);
    return row.part === 'forecast' ? validateForecast(data) : typeof data?.aqi === 'number' && Number.isFinite(data.aqi) ? data : null;
  } catch { return null; }
}

export function createWeatherService({ store, fetchImpl = fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 10000, onError = () => console.warn('Weather refresh could not be persisted; retrying automatically.') }) {
  let running = false; let generation = 0; let timer; let active; let draining;
  const queue = [];
  const requestOptions = { fetchImpl, schedule, cancel, timeoutMs };
  const jobKey = (row) => `${row.part}:${row.timezone}:${row.revision}:${row.registration}`;
  const pending = (row) => Boolean(row && (queue.some((job) => jobKey(job.row) === jobKey(row)) || (active && jobKey(active.row) === jobKey(row))));
  const eligible = (row) => row.attempted === null || now() - row.attempted >= WEATHER_REFRESH_MS;

  function arm() {
    cancel(timer); timer = undefined;
    if (!running) return;
    let delay = WEATHER_REFRESH_MS;
    try {
      for (const row of [...store.listWeatherVariants(), store.getWeatherPart('air')].filter(Boolean)) {
        if (row.attempted !== null && !pending(row)) delay = Math.min(delay, Math.max(1000, row.attempted + WEATHER_REFRESH_MS - now()));
      }
    } catch { delay = 60000; onError(); }
    timer = schedule(() => { timer = undefined; refreshRetained(false); }, delay);
    timer?.unref?.();
  }

  async function run(job) {
    if (!store.weatherPartCurrent(job.row)) return;
    if (!store.beginWeatherAttempt(job.row, now())) return;
    job.attemptStarted = true;
    const location = store.getWeatherLocation().location;
    const urls = weatherUrls(location, job.row.timezone || 'UTC');
    try {
      const data = await retrieve(urls[job.row.part], job.controller, requestOptions);
      const payload = job.row.part === 'forecast' ? normalizeForecast(data) : normalizeAir(data);
      if (running && job.generation === generation && store.weatherPartCurrent(job.row)) store.finishWeatherAttempt(job.row, payload, now());
    } catch {
      if (running && job.generation === generation && store.weatherPartCurrent(job.row)) store.finishWeatherAttempt(job.row, null, now());
    } finally { job.attemptStarted = false; }
  }

  function drain() {
    if (draining || !running) return;
    draining = Promise.resolve().then(async () => {
      while (running && queue.length) {
        active = queue.shift();
        try { await run(active); } catch { onError(); }
        active = undefined;
      }
    }).finally(() => { draining = undefined; if (queue.length) drain(); arm(); });
  }

  function enqueue(row, force = false) {
    if (!running || !row || pending(row) || (!force && !eligible(row))) return false;
    queue.push({ row, generation, controller: new AbortController() }); drain();
    return true;
  }

  function baseline() {
    store.registerWeatherPart('forecast', 'UTC', now(), false);
    store.registerWeatherPart('air', '', now(), false);
  }

  function refreshRetained(force) {
    try {
      if (store.getWeatherLocation().location) {
        baseline();
        for (const row of store.listWeatherVariants()) enqueue(row, force);
        enqueue(store.getWeatherPart('air'), force);
      }
    } catch { onError(); }
    arm();
  }

  function snapshot(timezone = 'UTC') {
    const zone = weatherTimezone(timezone); const saved = store.getWeatherLocation();
    const forecastRow = saved.location ? store.getWeatherPart('forecast', zone) : null;
    const airRow = saved.location ? store.getWeatherPart('air') : null;
    const forecast = cachedPart(forecastRow); const air = cachedPart(airRow);
    return { ...saved, configured: Boolean(saved.location), timezone: zone, forecastRegistered: Boolean(forecastRow), forecast, air, forecastUpdated: forecast ? forecastRow.updated : null, airUpdated: air ? airRow.updated : null, forecastError: Boolean(forecastRow?.failed), airError: Boolean(airRow?.failed), refreshing: pending(forecastRow) || pending(airRow) };
  }

  return {
    start() { if (running) return; running = true; refreshRetained(true); },
    snapshot,
    ensureFresh(timezone = 'UTC') {
      const zone = weatherTimezone(timezone);
      if (!running) throw new Error('Weather service is stopped');
      if (!store.getWeatherLocation().location) return { scheduled: false, refreshing: false };
      baseline();
      const row = store.registerWeatherPart('forecast', zone, now());
      // Remove evicted queued registrations before accepting replacement work.
      for (let i = queue.length - 1; i >= 0; i--) if (!store.weatherPartCurrent(queue[i].row)) queue.splice(i, 1);
      if (active && !store.weatherPartCurrent(active.row)) active.controller.abort();
      const forecastScheduled = enqueue(row); const airScheduled = enqueue(store.getWeatherPart('air'));
      arm();
      return { scheduled: forecastScheduled || airScheduled, refreshing: pending(row) || pending(store.getWeatherPart('air')) };
    },
    saveLocation(location, revision) {
      const saved = store.saveWeatherLocation(location, revision);
      if (!saved || !saved.changed) return saved ? snapshot() : null;
      generation++; queue.length = 0;
      if (active) {
        active.controller.abort();
        if (!saved.coordinatesChanged && active.attemptStarted) {
          const retagged = store.getWeatherPart(active.row.part, active.row.timezone);
          if (retagged?.registration === active.row.registration) store.resetWeatherAttempt(retagged);
        }
      }
      // Failed scheduling must not turn a committed location save into a failed save.
      refreshRetained(saved.coordinatesChanged);
      return snapshot();
    },
    async stop() {
      running = false; generation++; cancel(timer); timer = undefined; queue.length = 0;
      active?.controller.abort(); await draining;
    }
  };
}
