import { normalizeForecast, normalizeAir, validateWeatherLocation, weatherTimezone } from '../public/weather-data.js';
import { localWeatherSource, MAX_LOCAL_WEATHER_BYTES } from '../public/local-weather-data.js';
import { createWeatherTransport, providerJson, weatherUrls } from './weather-provider.js';

export function createLocalWeatherService({ fetchImpl, now = Date.now, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 10000 } = {}) {
  const transport = fetchImpl ? null : createWeatherTransport(); const fetchProvider = fetchImpl ?? transport.fetch;
  const entries = new Map(); const queue = []; const active = new Set(); let running = false; let stopped = false; let stopping;
  const bytes = row => Buffer.byteLength(JSON.stringify([row.forecast, row.air]));
  const totalBytes = () => [...entries.values()].reduce((total, row) => total + bytes(row), 0);
  function reclaim(exclude) { const candidate = [...entries].filter(([, row]) => row !== exclude && !row.pending).sort((a, b) => a[1].touched - b[1].touched)[0]; if (!candidate) return false; entries.delete(candidate[0]); return true; }
  function drain() {
    while (running && active.size < 2 && queue.length) {
      const job = queue.shift(); const { row, part } = job;
      if (entries.get(row.sourceId) !== row) continue;
      const controller = new AbortController(); job.controller = controller;
      job.timer = schedule(() => { row[`${part}Error`] = true; controller.abort(); }, timeoutMs);
      const work = Promise.resolve().then(() => providerJson(weatherUrls(row.location, row.timezone)[part], controller.signal, fetchProvider)).then(data => {
        if (!running || controller.signal.aborted || entries.get(row.sourceId) !== row) return;
        const payload = part === 'forecast' ? normalizeForecast(data) : normalizeAir(data); const old = row[part]; row[part] = payload;
        while (totalBytes() > 512 * 1024 && reclaim(row)) { /* Reclaim inactive data before accepting new bytes. */ }
        if (totalBytes() > 512 * 1024) { row[part] = old; throw new Error('Local weather cache is full.'); }
        row[`${part}Updated`] = now(); row[`${part}Error`] = false;
      }).catch(() => { if (!stopped && entries.get(row.sourceId) === row) row[`${part}Error`] = true; }).finally(() => {
        cancel(job.timer); row.pending--; active.delete(job); if (running) drain();
      });
      job.work = work; active.add(job);
    }
  }
  return {
    start() { if (!stopped) running = true; },
    query(location, timezone) {
      if (!running) throw Object.assign(new Error('Local weather is unavailable.'), { status: 503 });
      const place = validateWeatherLocation(location); const zone = weatherTimezone(timezone); const sourceId = localWeatherSource(place, zone);
      let row = entries.get(sourceId);
      if (!row) {
        if (entries.size >= 16 && !reclaim()) throw Object.assign(new Error('Local weather is busy. Retry later.'), { status: 429 });
        row = { sourceId, location: place, timezone: zone, forecast: null, air: null, forecastUpdated: null, airUpdated: null, forecastError: false, airError: false, attempted: null, pending: 0, touched: now() }; entries.set(sourceId, row);
      }
      row.touched = now();
      if (!row.pending && (row.attempted === null || now() - row.attempted >= 3600000)) {
        row.attempted = now(); row.pending = 2; for (const part of ['forecast', 'air']) queue.push({ row, part }); drain();
      }
      const snapshot = { scope: 'local', sourceId, configured: true, revision: 0, location: place, timezone: zone, forecastRegistered: true, forecast: row.forecast, air: row.air, forecastUpdated: row.forecastUpdated, airUpdated: row.airUpdated, forecastError: row.forecastError, airError: row.airError, refreshing: row.pending > 0 };
      if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_LOCAL_WEATHER_BYTES) throw new Error('Local weather snapshot exceeds limits.');
      return structuredClone(snapshot);
    },
    stop() {
      if (stopping) return stopping;
      running = false; stopped = true; queue.length = 0;
      for (const job of active) { cancel(job.timer); job.controller.abort(); }
      stopping = Promise.all([...active].map(job => job.work)).then(async () => { entries.clear(); await transport?.stop(); }); return stopping;
    }
  };
}
