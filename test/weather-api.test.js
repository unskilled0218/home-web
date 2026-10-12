import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createWeatherService } from '../src/weather.js';
import { normalizeForecast } from '../public/weather-data.js';
import { location, epoch, rawForecast } from './fixtures/weather.js';

async function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'weather-api-')); const filename = path.join(directory, 'home.db'); const store = createStore(filename);
  let calls = 0;
  const weather = createWeatherService({ store, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  weather.start();
  const server = createDashboardServer({ store, weather, runtimeConfig: { allowedHosts: ['127.0.0.1'] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await weather.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method = 'GET', body, headers = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { base, request, store, weather, filename, calls: () => calls };
}

test('weather API reads persisted snapshots immediately and saves shared locations with revision conflicts', async (t) => {
  const env = await setup(t);
  const initial = await (await env.request('/api/weather')).json();
  assert.equal(initial.configured, false); assert.equal(initial.revision, 0); assert.equal(initial.location, null);
  const saves = await Promise.all([env.request('/api/weather/location', 'PUT', { location, revision: 0 }), env.request('/api/weather/location', 'PUT', { location: { ...location, label: 'Other client' }, revision: 0 })]);
  assert.deepEqual(saves.map((response) => response.status).sort(), [200, 409]);
  const saved = await saves.find((response) => response.status === 200).json(); assert.equal(saved.revision, 1);
  const row = env.store.getWeatherPart('forecast', 'UTC');
  env.store.finishWeatherAttempt(row, normalizeForecast(rawForecast()), epoch);
  const response = await env.request('/api/weather');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const cached = await response.json(); assert.equal(cached.forecast.current.temperature_2m, 12); assert.equal(cached.forecastUpdated, epoch); assert.equal(cached.refreshing, true);
  const secondClient = await (await env.request('/api/weather')).json(); assert.deepEqual(secondClient.location, saved.location);
  const refresh = await env.request('/api/weather/refresh', 'POST', { timezone: 'UTC' });
  assert.equal(refresh.status, 202); assert.equal((await refresh.json()).refreshing, true);
  assert.equal(env.calls(), 1, 'blocked provider remains coalesced and never blocks GET or POST');
  const missing = await (await env.request('/api/weather?timezone=Asia%2FTokyo')).json();
  assert.equal(missing.forecast, null); assert.equal(missing.forecastRegistered, false);
});

test('weather APIs reject invalid inputs, unsupported methods, and untrusted hosts and origins', async (t) => {
  const env = await setup(t);
  for (const body of [null, [], {}, { location, revision: -1 }, { location: { ...location, latitude: 100 }, revision: 0 }, { location: { ...location, label: '' }, revision: 0 }, { location, revision: 0, extra: true }, { location: { ...location, extra: 'x' }, revision: 0 }]) assert.equal((await env.request('/api/weather/location', 'PUT', body)).status, 400, JSON.stringify(body));
  assert.equal((await env.request('/api/weather?timezone=bad')).status, 400);
  for (const body of [{}, { timezone: 'bad' }, { timezone: 'UTC', force: true }]) assert.equal((await env.request('/api/weather/refresh', 'POST', body)).status, 400);
  for (const [route, method] of [['/api/weather', 'POST'], ['/api/weather/location', 'GET'], ['/api/weather/refresh', 'PUT']]) assert.equal((await env.request(route, method)).status, 405);
  assert.equal((await env.request('/api/weather/location', 'PUT', { location, revision: 0 }, { origin: 'https://untrusted.test' })).status, 403);
  const badHost = await new Promise((resolve, reject) => { const request = http.get(`${env.base}/api/weather`, { headers: { host: 'untrusted.test' } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); });
  assert.equal(badHost, 403);
  assert.equal((await env.request('/api/weather/location', 'PUT', { location: { ...location, label: 'x'.repeat(17000) }, revision: 0 })).status, 400);
  assert.deepEqual(await (await env.request('/api/weather/refresh', 'POST', { timezone: 'UTC' })).json(), { scheduled: false, refreshing: false });
});

test('database errors produce service errors without rewriting the saved location', async (t) => {
  const env = await setup(t);
  const save = env.store.saveWeatherLocation; env.store.saveWeatherLocation = () => { throw new Error('database'); };
  assert.equal((await env.request('/api/weather/location', 'PUT', { location, revision: 0 })).status, 503);
  env.store.saveWeatherLocation = save; assert.equal(env.store.getWeatherLocation().revision, 0);
  const get = env.store.getWeatherLocation; env.store.getWeatherLocation = () => { throw new Error('database'); };
  assert.equal((await env.request('/api/weather')).status, 503);
  env.store.getWeatherLocation = get;
});

test('weather migration preserves existing records and cache persists across database restart', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'weather-restart-')); const filename = path.join(directory, 'home.db');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let store = createStore(filename); const device = store.create({ name: 'PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', group: '', ipAddress: null }); store.close();
  const db = new DatabaseSync(filename); db.exec('DROP TABLE weather_location; DROP TABLE weather_cache;'); db.close();
  store = createStore(filename); assert.equal(store.get(device.id).name, 'PC'); store.saveWeatherLocation(location, 0);
  const row = store.registerWeatherPart('forecast', 'UTC', epoch); store.beginWeatherAttempt(row, epoch); store.finishWeatherAttempt(row, normalizeForecast(rawForecast()), epoch); store.close();
  store = createStore(filename); assert.deepEqual(store.getWeatherLocation(), { location, revision: 1 });
  const restored = store.getWeatherPart('forecast', 'UTC'); assert.equal(restored.updated, epoch); assert.equal(JSON.parse(restored.payload).current.temperature_2m, 12);
  store.close();
  const corrupt = new DatabaseSync(filename); corrupt.prepare('UPDATE weather_location SET location = ?').run('{broken'); corrupt.close();
  store = createStore(filename); assert.throws(() => store.getWeatherLocation()); store.close();
});

test('app construction without weather injection does not start provider work', async (t) => {
  const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/weather`)).status, 503); assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
