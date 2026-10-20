import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalWeatherService } from '../src/local-weather.js';
import { createLocalWeatherController } from '../public/dashboard-local-weather.js';
import { validateLocalWeatherSnapshot } from '../public/local-weather-data.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { rawAir, rawForecast } from './fixtures/weather.js';
import { slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

const location = { latitude: 51, longitude: 0, label: 'London' };
const result = url => Response.json(url.hostname.startsWith('air-') ? { current: { us_aqi: 20 } } : rawForecast());

test('Local weather coalesces keys, projects per-browser labels, throttles retries, and isolates cities/timezones', async t => {
  const clock = slideshowClock(); const urls = []; const service = createLocalWeatherService({ ...clock, fetchImpl: async url => { urls.push(url); return result(url); } }); service.start(); t.after(() => service.stop());
  assert.equal(service.query(location, 'UTC').refreshing, true); service.query({ ...location, label: 'My place' }, 'UTC'); await tick();
  const state = service.query({ ...location, label: 'My place' }, 'UTC'); assert.equal(state.refreshing, false); assert.equal(state.forecast.current.temperature_2m, 12); assert.equal(state.location.label, 'My place'); assert.equal(urls.length, 2);
  validateLocalWeatherSnapshot(state, state.location, 'UTC'); service.query({ ...location, latitude: 35 }, 'Asia/Tokyo'); await tick(); assert.equal(urls.length, 4);
  await clock.advance(60000); service.query(location, 'UTC'); assert.equal(urls.length, 4); await clock.advance(3540000); service.query(location, 'UTC'); await tick(); assert.equal(urls.length, 6);
  assert.throws(() => validateLocalWeatherSnapshot(state, { ...location, latitude: 0 }, 'UTC'), /source/);
});

test('Local failures retain same-source successful parts and do not immediately retry failed providers', async t => {
  const clock = slideshowClock(); let calls = 0; let fail = false; const service = createLocalWeatherService({ ...clock, fetchImpl: async url => { calls++; if (fail || url.hostname.startsWith('air-')) throw new Error('fixture'); return result(url); } }); service.start(); t.after(() => service.stop());
  service.query(location, 'UTC'); await tick(); let state = service.query(location, 'UTC'); assert.ok(state.forecast); assert.equal(state.air, null); assert.equal(state.airError, true); assert.equal(calls, 2);
  fail = true; await clock.advance(3600000); service.query(location, 'UTC'); await tick(); state = service.query(location, 'UTC'); assert.ok(state.forecast); assert.equal(state.forecastError, true); assert.equal(calls, 4);
  assert.equal(service.query({ ...location, latitude: 0 }, 'UTC').forecast, null);
});

test('Local AQI recovers hourly to zero and malformed refreshes retain its successful timestamp', async t => {
  const clock = slideshowClock(); let mode = 'offline'; let airCalls = 0;
  const service = createLocalWeatherService({ ...clock, fetchImpl: async url => {
    if (!url.hostname.startsWith('air-')) return result(url);
    airCalls++;
    if (mode === 'offline') throw new Error('offline');
    return Response.json(mode === 'valid' ? rawAir(0) : rawAir(null));
  } });
  service.start(); t.after(() => service.stop()); service.query(location, 'UTC'); await tick();
  const failed = service.query(location, 'UTC');
  assert.equal(failed.air, null); assert.equal(failed.airUpdated, null); assert.equal(failed.airError, true); assert.ok(failed.forecast);
  mode = 'valid'; service.query(location, 'UTC'); await tick(); assert.equal(airCalls, 1);
  await clock.advance(3600000); service.query(location, 'UTC'); await tick();
  const recovered = service.query(location, 'UTC');
  assert.deepEqual(recovered.air, { aqi: 0 }); assert.equal(recovered.airUpdated, clock.now()); assert.equal(recovered.airError, false);
  mode = 'invalid'; await clock.advance(3600000); service.query(location, 'UTC'); await tick();
  const stale = service.query(location, 'UTC');
  assert.deepEqual(stale.air, recovered.air); assert.equal(stale.airUpdated, recovered.airUpdated); assert.equal(stale.airError, true); assert.equal(stale.forecastError, false);
});

test('Local weather admits at most sixteen keys/two active requests and drains real work after cancellation', async () => {
  const clock = slideshowClock(); const pending = [];
  const service = createLocalWeatherService({ ...clock, fetchImpl: (url, options) => { const work = deferred(); pending.push({ ...work, url, signal: options.signal }); return work.promise; } }); service.start();
  for (let i = 0; i < 16; i++) service.query({ ...location, latitude: i }, 'UTC'); await tick(); assert.equal(pending.length, 2);
  assert.throws(() => service.query({ ...location, latitude: 30 }, 'UTC'), { status: 429 });
  let drained = false; const stopped = service.stop().then(() => { drained = true; }); await tick(); assert.equal(drained, false); assert.ok(pending.every(work => work.signal.aborted));
  pending.forEach(work => work.resolve(result(work.url))); await stopped; assert.equal(clock.timers.size, 0); assert.throws(() => service.query(location, 'UTC'), { status: 503 });
});

test('Local cache evicts inactive keys, bounds provider bodies, and times out body consumption', async t => {
  const clock = slideshowClock(); let mode = 'good'; let canceled = false;
  const service = createLocalWeatherService({ ...clock, fetchImpl: async url => mode === 'large' ? new Response('x'.repeat(1024 * 1024 + 1)) : mode === 'stalled' ? new Response(new ReadableStream({ cancel() { canceled = true; } })) : result(url) }); service.start(); t.after(() => service.stop());
  for (let i = 0; i < 17; i++) { service.query({ ...location, latitude: i }, 'UTC'); await tick(); }
  mode = 'large'; service.query({ ...location, latitude: 20 }, 'UTC'); await tick(); assert.equal(service.query({ ...location, latitude: 20 }, 'UTC').forecastError, true);
  mode = 'stalled'; service.query({ ...location, latitude: 21 }, 'UTC'); await tick(); await clock.advance(10000); assert.equal(canceled, true); assert.equal(service.query({ ...location, latitude: 21 }, 'UTC').forecastError, true);
});

test('Local browser weather retires old locations, pauses reads, and reprojects units without global mutations', async () => {
  const clock = slideshowClock(); const requests = []; const pending = []; const states = [];
  const client = createLocalWeatherController({ ...clock, onChange: value => states.push(value), fetchImpl: async (url, options) => { requests.push({ url, options }); const work = deferred(); pending.push({ ...work, input: JSON.parse(options.body) }); return work.promise; } });
  client.configure(normalizeDashboardPreferences(), null); assert.equal(requests.length, 0);
  client.configure(normalizeDashboardPreferences(), location); await tick(); client.configure(normalizeDashboardPreferences(), { ...location, latitude: 35 }); await tick();
  const service = createLocalWeatherService({ ...clock, fetchImpl: async url => url.hostname.startsWith('air-') ? Response.json(rawAir(Number(url.searchParams.get('latitude')))) : result(url) }); service.start();
  for (const work of pending.toReversed()) { service.query(work.input.location, work.input.timezone); await tick(); work.resolve(Response.json(service.query(work.input.location, work.input.timezone))); await tick(); }
  assert.equal(states.at(-1).location.latitude, 35); assert.deepEqual(states.at(-1).air, { aqi: 35 }); assert.equal(states.at(-1).airUpdated, clock.now()); assert.equal(states.at(-1).airError, false); assert.equal(requests.every(request => request.url === '/api/weather/local'), true);
  const reads = requests.length; client.configure(normalizeDashboardPreferences({ temperature: 'fahrenheit' }), { ...location, latitude: 35 }); assert.equal(states.at(-1).forecast.current.temperature_2m, 53.6); assert.equal(requests.length, reads);
  client.setVisible(false); assert.equal(clock.timers.size, 0); client.dispose(); await service.stop();
});
