import { normalizeAir, normalizeForecast, validateForecast, validTimestamp, weatherTimezone } from '../public/weather-data.js';
import { weatherUrls, retrieve } from './weather-provider.js';
export { weatherUrls } from './weather-provider.js';

export const WEATHER_REFRESH_MS = 3600000;

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

  function reloadLocation(saved) {
    if (!saved?.changed) return snapshot();
    generation++; queue.length = 0;
    if (active) {
      active.controller.abort();
      if (!saved.coordinatesChanged && active.attemptStarted) {
        const retagged = store.getWeatherPart(active.row.part, active.row.timezone);
        if (retagged?.registration === active.row.registration) store.resetWeatherAttempt(retagged);
      }
    }
    refreshRetained(saved.coordinatesChanged); return snapshot();
  }
  return {
    start() { if (running) return; running = true; refreshRetained(true); },
    snapshot,
    reloadLocation,
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
      // Failed scheduling must not turn a committed location save into a failed save.
      return reloadLocation(saved);
    },
    async stop() {
      running = false; generation++; cancel(timer); timer = undefined; queue.length = 0;
      active?.controller.abort(); await draining;
    }
  };
}
