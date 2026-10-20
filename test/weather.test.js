import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { createWeatherService, WEATHER_REFRESH_MS } from '../src/weather.js';
import { location, epoch, rawAir, rawForecast } from './fixtures/weather.js';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); };
const providerResponse = (url, temperature = 12) => Response.json(url.hostname.startsWith('air-') ? { current: { us_aqi: 20 } } : rawForecast(temperature));

function setup(t, fetchImpl = async (url) => providerResponse(url)) {
  const directory = mkdtempSync(path.join(tmpdir(), 'weather-')); const filename = path.join(directory, 'home.db');
  const store = createStore(filename); const tasks = new Map(); let clock = epoch; let id = 0; const errors = [];
  const service = createWeatherService({ store, fetchImpl, now: () => clock, schedule(fn, delay) { tasks.set(++id, { fn, delay }); return id; }, cancel(key) { tasks.delete(key); }, onError: () => errors.push('storage') });
  t.after(async () => { await service.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, service, filename, tasks, errors, advance(ms) { clock += ms; }, runTimer(delay) { const [key, timer] = [...tasks].find(([, task]) => task.delay === delay) ?? []; assert.ok(timer, `timer with ${delay}ms delay exists`); tasks.delete(key); timer.fn(); } };
}

test('server refreshes at startup and hourly without browsers and coalesces clients', async (t) => {
  const calls = [];
  const env = setup(t, async (url) => { calls.push(url); return providerResponse(url); });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  const first = env.service.snapshot();
  assert.equal(first.forecast.current.temperature_2m, 12); assert.equal(first.air.aqi, 20); assert.equal(first.forecastUpdated, epoch);
  assert.equal(calls.length, 2); assert.equal(env.tasks.size, 1);
  for (let i = 0; i < 5; i++) assert.deepEqual(env.service.ensureFresh('UTC'), { scheduled: false, refreshing: false });
  assert.equal(calls.length, 2);
  env.advance(WEATHER_REFRESH_MS); env.runTimer(WEATHER_REFRESH_MS); await settle();
  assert.equal(calls.length, 4); assert.equal(env.service.snapshot().forecastUpdated, epoch + WEATHER_REFRESH_MS);
  assert.equal(env.tasks.size, 1);
  env.service.ensureFresh('Asia/Tokyo'); env.service.ensureFresh('Asia/Tokyo'); await settle();
  assert.equal(calls.length, 5, 'new timezone shares already fresh AQI');
  assert.equal(calls[4].searchParams.get('timezone'), 'Asia/Tokyo');
  assert.equal(calls[4].searchParams.get('temperature_unit'), 'celsius');
  assert.equal(env.errors.length, 0);
});

test('failed first forecast and AQI attempts respect the hourly deadline even without cached data', async (t) => {
  let calls = 0;
  const env = setup(t, async () => { calls++; throw new Error('offline'); });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  const first = env.service.snapshot();
  assert.equal(first.forecast, null); assert.equal(first.air, null); assert.equal(first.forecastError, true); assert.equal(first.airError, true);
  assert.equal(first.refreshing, false); assert.equal(calls, 2);
  for (let i = 0; i < 10; i++) env.service.ensureFresh('UTC'); await settle();
  assert.equal(calls, 2);
  env.advance(WEATHER_REFRESH_MS - 1); env.service.ensureFresh('UTC'); await settle(); assert.equal(calls, 2);
  env.advance(1); env.service.ensureFresh('UTC'); await settle(); assert.equal(calls, 4);
  assert.equal(env.service.snapshot().forecastUpdated, null);
});

test('timezone variants preserve provider-local daily dates and day/night fields', async (t) => {
  const env = setup(t, async (url) => {
    if (url.hostname.startsWith('air-')) return providerResponse(url);
    const data = rawForecast();
    const tokyo = url.searchParams.get('timezone') === 'Asia/Tokyo';
    data.utc_offset_seconds = tokyo ? 32400 : 0;
    data.daily.time[0] = Date.parse(tokyo ? '2026-10-10T15:00:00Z' : '2026-10-11T00:00:00Z') / 1000;
    data.hourly.is_day[0] = tokyo ? 0 : 1;
    return Response.json(data);
  });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  env.service.ensureFresh('Asia/Tokyo'); await settle();
  assert.equal(env.service.snapshot('UTC').forecast.daily[0].date, '2026-10-11');
  assert.equal(env.service.snapshot('Asia/Tokyo').forecast.daily[0].date, '2026-10-11');
  assert.equal(env.service.snapshot('UTC').forecast.hourly[0].day, 1);
  assert.equal(env.service.snapshot('Asia/Tokyo').forecast.hourly[0].day, 0);
  assert.notEqual(env.store.getWeatherPart('forecast', 'UTC').registration, env.store.getWeatherPart('forecast', 'Asia/Tokyo').registration);
});

test('independent failures preserve successful parts and only forecast success advances its timestamp', async (t) => {
  let failForecast = false; let failAir = true;
  const env = setup(t, async (url) => {
    if (url.hostname.startsWith('air-') ? failAir : failForecast) throw new Error('offline');
    return url.hostname.startsWith('air-') ? Response.json(rawAir(0)) : providerResponse(url);
  });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  assert.equal(env.service.snapshot().forecastUpdated, epoch); assert.equal(env.service.snapshot().airError, true);
  failForecast = true; failAir = false;
  env.advance(WEATHER_REFRESH_MS); env.service.ensureFresh('UTC'); await settle();
  const partial = env.service.snapshot();
  assert.equal(partial.forecast.current.temperature_2m, 12); assert.equal(partial.forecastUpdated, epoch); assert.equal(partial.forecastError, true);
  assert.equal(partial.air.aqi, 0); assert.equal(partial.airUpdated, epoch + WEATHER_REFRESH_MS); assert.equal(partial.airError, false);
  failForecast = false; failAir = true;
  env.advance(WEATHER_REFRESH_MS); env.service.ensureFresh('UTC'); await settle();
  assert.equal(env.service.snapshot().forecastUpdated, epoch + 2 * WEATHER_REFRESH_MS);
  assert.equal(env.service.snapshot().airUpdated, partial.airUpdated); assert.equal(env.service.snapshot().airError, true);
});

test('coordinate changes reject late results even when a provider ignores abort', async (t) => {
  let resolveOld; let calls = 0;
  const env = setup(t, (url) => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { resolveOld = resolve; });
    return Promise.resolve(providerResponse(url, 25));
  });
  env.service.start(); env.service.saveLocation(location, 0); await settle();
  assert.equal(env.service.snapshot().refreshing, true);
  const saved = env.service.saveLocation({ latitude: 35, longitude: 139, label: 'Tokyo' }, 1);
  assert.equal(saved.forecast, null); await settle();
  assert.equal(env.service.snapshot().forecast.current.temperature_2m, 25);
  resolveOld(Response.json(rawForecast(1))); await settle();
  assert.equal(env.service.snapshot().location.label, 'Tokyo'); assert.equal(env.service.snapshot().forecast.current.temperature_2m, 25);
  assert.equal(env.service.snapshot().forecastError, false); assert.equal(env.tasks.size, 1);
});

test('late air results cannot replace the new location AQI, timestamp, or error state', async t => {
  let resolveOld;
  const env = setup(t, async url => {
    if (!url.hostname.startsWith('air-')) return providerResponse(url);
    if (url.searchParams.get('latitude') === String(location.latitude)) return new Promise(resolve => { resolveOld = resolve; });
    return Response.json(rawAir(91));
  });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  assert.equal(typeof resolveOld, 'function', 'the old forecast finished and its air request is pending');
  env.advance(1000); env.service.saveLocation({ latitude: 37.566, longitude: 126.9784, label: 'Seoul' }, 1); await settle();
  const current = env.service.snapshot();
  assert.deepEqual(current.air, { aqi: 91 }); assert.equal(current.airUpdated, epoch + 1000); assert.equal(current.airError, false);
  resolveOld(Response.json(rawAir(12))); await settle();
  const after = env.service.snapshot();
  assert.deepEqual(after.air, current.air); assert.equal(after.airUpdated, current.airUpdated); assert.equal(after.airError, current.airError);
});

for (const cached of [false, true]) test(`label-only revision replaces interrupted work and preserves ${cached ? 'cached' : 'first-load'} state`, async (t) => {
  let block = !cached; let resolveOld; let calls = 0;
  const env = setup(t, (url) => {
    calls++;
    if (block && !url.hostname.startsWith('air-')) { block = false; return new Promise((resolve) => { resolveOld = resolve; }); }
    return Promise.resolve(providerResponse(url, 18));
  });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  if (cached) { block = true; env.advance(WEATHER_REFRESH_MS); env.service.ensureFresh('UTC'); await settle(); }
  const previous = env.service.snapshot();
  const renamed = env.service.saveLocation({ ...location, label: 'London, UK' }, 1);
  assert.equal(renamed.location.label, 'London, UK');
  assert.equal(renamed.forecastUpdated, previous.forecastUpdated);
  if (cached) assert.equal(renamed.forecast.current.temperature_2m, 18);
  await settle(); resolveOld(Response.json(rawForecast(2))); await settle();
  const final = env.service.snapshot();
  assert.equal(final.revision, 2); assert.equal(final.forecast.current.temperature_2m, 18); assert.equal(final.refreshing, false); assert.equal(final.forecastError, false);
  const count = calls; env.service.saveLocation({ ...location, label: 'London, UK' }, 2); await settle();
  assert.equal(calls, count, 'identical save must not refetch');
});

test('timezone eviction is bounded, uses browser activity, and rejects old registrations', async (t) => {
  const env = setup(t); env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  const zones = ['Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Auckland'];
  for (const zone of zones) { env.advance(1000); env.service.ensureFresh(zone); await settle(); }
  const old = env.store.getWeatherPart('forecast', 'Asia/Tokyo');
  env.service.snapshot('Asia/Tokyo');
  env.advance(1000); env.service.ensureFresh('Europe/London');
  env.advance(1000); env.service.ensureFresh('Asia/Seoul'); await settle();
  assert.equal(env.store.listWeatherVariants().length, 8); assert.equal(env.service.snapshot('Asia/Tokyo').forecastRegistered, false);
  assert.equal(env.service.snapshot('Europe/London').forecastRegistered, true); assert.equal(env.service.snapshot('UTC').forecastRegistered, true);
  env.service.ensureFresh('Asia/Tokyo'); await settle();
  assert.equal(env.service.snapshot('Asia/Tokyo').forecast.current.temperature_2m, 12);
  assert.equal(env.store.finishWeatherAttempt(old, {}, epoch), false, 'evicted registration cannot overwrite replacement');
  assert.equal(env.store.listWeatherVariants().length, 8);
});

test('corrupt cache is withheld and cannot bypass a failed-attempt retry deadline', async (t) => {
  let calls = 0;
  const env = setup(t, async (url) => { calls++; return providerResponse(url); });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  const db = new DatabaseSync(env.filename);
  db.prepare("UPDATE weather_cache SET payload = ?, failed = 1 WHERE part = 'forecast'").run('{broken'); db.close();
  assert.equal(env.service.snapshot().forecast, null); assert.equal(env.service.snapshot().forecastUpdated, null);
  env.service.ensureFresh('UTC'); await settle(); assert.equal(calls, 2);
  env.advance(WEATHER_REFRESH_MS); env.service.ensureFresh('UTC'); await settle();
  assert.equal(env.service.snapshot().forecast.current.temperature_2m, 12); assert.equal(env.service.snapshot().forecastError, false);
});

test('deadline aborts stalled requests and stop settles work before the store closes', async (t) => {
  const signals = [];
  const env = setup(t, (_url, { signal }) => { signals.push(signal); return new Promise(() => {}); });
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  env.runTimer(10000); await settle();
  assert.equal(signals[0].aborted, true); assert.equal(env.service.snapshot().forecastError, true);
  await env.service.stop();
  assert.equal(signals[1].aborted, true); assert.equal(env.tasks.size, 0);
  assert.equal(env.service.snapshot().refreshing, false);
});

test('oversized, malformed, and unsuccessful provider responses do not become cached successes', async (t) => {
  const env = setup(t, async (url) => url.hostname.startsWith('air-') ? Response.json({ error: true }) : new Response('x'.repeat(1024 * 1024 + 1)));
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  assert.equal(env.service.snapshot().forecast, null); assert.equal(env.service.snapshot().forecastError, true);
  assert.equal(env.service.snapshot().air, null); assert.equal(env.service.snapshot().airError, true);
});

test('persistence failures do not kill the scheduler or advertise a successful cache write', async (t) => {
  const env = setup(t); const finish = env.store.finishWeatherAttempt;
  env.store.finishWeatherAttempt = () => { throw new Error('storage'); };
  env.store.saveWeatherLocation(location, 0); env.service.start(); await settle();
  assert.equal(env.service.snapshot().forecastUpdated, null); assert.ok(env.errors.length > 0); assert.equal(env.tasks.size, 1);
  env.store.finishWeatherAttempt = finish;
  env.advance(WEATHER_REFRESH_MS); env.service.ensureFresh('UTC'); await settle();
  assert.equal(env.service.snapshot().forecastUpdated, epoch + WEATHER_REFRESH_MS);
});
