import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDashboardServer } from '../src/app.js';
import { clockText, loadSettings, normalizeSettings, orderPhotos, sampleHours, selectPhotos, weatherIconKey } from '../public/dashboard-helpers.js';
import { createWeatherController, normalizeForecast, requestJson, searchLocations, weatherUrls } from '../public/dashboard-weather.js';
import { createPhotoController } from '../public/dashboard-photos.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settings = (extra = {}) => normalizeSettings({ location: { latitude: 51, longitude: 0, label: 'London' }, timezone: 'Europe/London', ...extra });
const forecast = () => ({ current: { time: 1727740800, temperature_2m: 12, weather_code: 0 }, current_units: { temperature_2m: '°C' }, utc_offset_seconds: 3600, hourly: { time: [1727740800], temperature_2m: [12] }, daily: { time: [1727737200], temperature_2m_min: [8], temperature_2m_max: [15] } });
const response = (data) => ({ ok: true, json: async () => data });
function scheduler() {
  const tasks = new Map(); let id = 0;
  return { tasks, schedule(fn, delay) { tasks.set(++id, { fn, delay }); return id; }, cancel(key) { tasks.delete(key); } };
}

test('serves dashboard aliases and assets while preserving home and static containment', async (context) => {
  const server = createDashboardServer({ runtimeConfig: {}, store: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let previous;
  for (const route of ['/dashboard', '/dashboard/', '/dashboard']) {
    const result = await fetch(base + route); assert.equal(result.status, 200); assert.match(result.headers.get('content-type'), /text\/html/);
    const html = await result.text(); assert.match(html, /src="\/dashboard.js"/); assert.doesNotMatch(html, /src="\/app.js"/);
    if (previous) assert.equal(html, previous); previous = html;
  }
  for (const name of ['dashboard.js', 'dashboard-helpers.js', 'dashboard-weather.js', 'dashboard-photos.js', 'dashboard.css']) {
    const result = await fetch(`${base}/${name}`); assert.equal(result.status, 200); assert.match(result.headers.get('content-type'), name.endsWith('.css') ? /text\/css/ : /text\/javascript/);
  }
  const spriteResponse = await fetch(`${base}/weather-icons.svg`); assert.equal(spriteResponse.status, 200); assert.match(spriteResponse.headers.get('content-type'), /image\/svg\+xml/);
  const sprite = await spriteResponse.text();
  const symbols = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(symbols, ['clear-day', 'clear-night', 'partly-cloudy-day', 'partly-cloudy-night', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'thunderstorm', 'unknown']);
  assert.doesNotMatch(sprite, /<script|xlink:href|<text|\shref=/i);
  const dashboardHtml = await (await fetch(`${base}/dashboard.html`)).text(); assert.match(dashboardHtml, /id="weather-icon"[^>]*aria-hidden="true"[^>]*hidden/);
  const dashboardCss = await (await fetch(`${base}/dashboard.css`)).text(); assert.match(dashboardCss, /#weather \{[^}]*background: transparent;[^}]*border-radius: 0;/); assert.doesNotMatch(dashboardCss, /#weather \{[^}]*#08101bcc/);
  const dashboardJs = await (await fetch(`${base}/dashboard.js`)).text(); assert.match(dashboardJs, /`\/weather-icons\.svg#\$\{weatherIconKey\(/); assert.doesNotMatch(dashboardJs, /innerHTML/);
  assert.match(await (await fetch(base)).text(), /href="\/dashboard"/);
  for (const route of ['/missing', '/dashboard/missing', '/%2e%2e/package.json', '/..%2fpackage.json', '/src/app.js']) assert.equal((await fetch(base + route)).status, 404);
});

test('maps bounded WMO conditions to local weather icons', () => {
  const cases = [
    [0, 1, 'clear-day'], [0, 0, 'clear-night'], [1, 1, 'partly-cloudy-day'], [2, 0, 'partly-cloudy-night'], [3, 1, 'cloudy'],
    [45, 1, 'fog'], [48, 1, 'fog'], [51, 1, 'drizzle'], [55, 1, 'drizzle'], [56, 1, 'sleet'], [67, 1, 'sleet'],
    [61, 1, 'rain'], [65, 1, 'rain'], [80, 1, 'rain'], [82, 1, 'rain'], [71, 1, 'snow'], [77, 1, 'snow'], [85, 1, 'snow'], [86, 1, 'snow'],
    [95, 1, 'thunderstorm'], [99, 1, 'thunderstorm'], [4, 1, 'unknown'], [null, 1, 'unknown'], ['0', 1, 'unknown'], [NaN, 1, 'unknown'], [Infinity, 1, 'unknown']
  ];
  for (const [code, day, expected] of cases) assert.equal(weatherIconKey(code, day), expected, `${code}/${day}`);
  assert.equal(weatherIconKey(1, null), 'partly-cloudy-day');
});

test('recovers preferences and constrains untrusted persisted settings', () => {
  for (const storage of [undefined, { getItem() { throw new Error('blocked'); } }, { getItem: () => '{bad' }, { getItem: () => 'null' }]) assert.equal(loadSettings(storage).interval, 60);
  const result = normalizeSettings({ scale: 100, duration: 50, interval: 5, timeScale: NaN, opacity: -1, timezone: 'not/a/zone', location: { latitude: 999, longitude: 0 }, color: 'url(x)', extra: 'discard', weatherVisible: 'false' }, 'UTC');
  assert.equal(result.scale, 2); assert.equal(result.duration, 4); assert.equal(result.timeScale, 1); assert.equal(result.opacity, 0); assert.equal(result.timezone, 'UTC'); assert.equal(result.location, null); assert.equal(result.color, '#000000'); assert.equal(result.weatherVisible, true); assert.equal(result.extra, undefined);
});

test('formats clock across timezone date boundaries and daylight saving', () => {
  const instant = new Date('2026-01-01T00:30:00Z');
  assert.equal(clockText(instant, settings({ timezone: 'America/Los_Angeles', dateStyle: 'short' }), 'en-US').date, '12/31/25');
  assert.match(clockText(instant, settings({ timezone: 'Asia/Tokyo' }), 'en-GB').time, /09:30:00/);
  const summer = clockText(new Date('2026-07-01T12:00:00Z'), settings(), 'en-GB'); assert.equal(summer.time, '13:00:00');
});

test('bounds photo selection and provides deterministic ordering without mutating input', () => {
  const file = (name, size = 1, type = 'image/png', lastModified = 0) => ({ name, size, type, lastModified });
  const result = selectPhotos([file('bad', 1, 'text/plain'), file('large', 21 * 1024 ** 2), ...Array.from({ length: 101 }, (_, i) => file(String(i)))]);
  assert.equal(result.accepted.length, 100); assert.equal(result.excluded, 3);
  assert.equal(selectPhotos(Array.from({ length: 11 }, () => file('photo', 20 * 1024 ** 2))).accepted.length, 10);
  const photos = [{ file: file('z', 1, 'image/png', 1) }, { file: file('a', 1, 'image/png', 2) }];
  assert.equal(orderPhotos(photos, 'name')[0].file.name, 'a'); assert.equal(orderPhotos(photos, 'date')[0].file.name, 'z'); assert.equal(photos[0].file.name, 'z');
  assert.equal(orderPhotos(photos, 'random', () => 0)[0].file.name, 'a');
});

test('samples future hours with gaps, exhausted forecasts, and daily offset dates', () => {
  const rows = [0, 3600, 7200, 14400, 25200, 90000].map((time) => ({ time }));
  assert.deepEqual(sampleHours(rows, 1000).map((row) => row.time), [3600, 14400, 25200]);
  assert.deepEqual(sampleHours(rows, 100000000), []);
  const normalized = normalizeForecast(forecast()); assert.equal(normalized.daily[0].date, '2024-10-01');
  assert.throws(() => normalizeForecast({ current: { temperature_2m: '12' } }));
  assert.equal(normalizeForecast({ ...forecast(), hourly: { time: [1727740800], temperature_2m: [null] } }).hourly.length, 0);
});

test('constructs bounded provider queries and normalizes geocoding', async () => {
  const urls = weatherUrls(settings({ temperature: 'fahrenheit', wind: 'kn', precipitation: 'inch' }));
  assert.equal(urls.forecast.hostname, 'api.open-meteo.com'); assert.equal(urls.forecast.searchParams.get('timeformat'), 'unixtime'); assert.equal(urls.forecast.searchParams.get('wind_speed_unit'), 'kn'); assert.equal(urls.forecast.searchParams.get('precipitation_unit'), 'inch'); assert.equal(urls.air.searchParams.get('current'), 'us_aqi');
  const results = await searchLocations('x'.repeat(200), { fetchImpl: async (url, options) => {
    assert.equal(url.hostname, 'geocoding-api.open-meteo.com'); assert.equal(url.searchParams.get('name').length, 120); assert.equal(options.credentials, 'omit');
    return response({ results: [{ name: 'London', latitude: 51, longitude: 0 }, { name: 'Invalid', latitude: 999, longitude: 0 }] });
  } });
  assert.deepEqual(results, [{ label: 'London', latitude: 51, longitude: 0 }]);
  await assert.rejects(searchLocations('London', { fetchImpl: async () => response({ results: {} }) }));
});

test('aborts provider requests on deadline and caller cancellation', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(requestJson('https://example.test', { fetchImpl, timeoutMs: 5 }), /aborted/);
  const controller = new AbortController();
  const pending = requestJson('https://example.test', { fetchImpl, signal: controller.signal }); controller.abort(); await assert.rejects(pending, /aborted/);
  await assert.rejects(requestJson('https://example.test', { fetchImpl: async () => response({ error: true }) }));
});

test('weather keeps same-location stale data, handles partial failure, and owns one refresh timer', async () => {
  const timers = scheduler(); let mode = 'partial'; let latest; let calls = 0;
  const client = createWeatherController({ ...timers, now: () => 123, onChange: (state) => { latest = state; }, fetchImpl: async (url) => {
    calls++; if (mode === 'fail' || (mode === 'partial' && url.hostname.startsWith('air-'))) throw new Error('offline');
    return response(url.hostname.startsWith('air-') ? { current: { us_aqi: 20 } } : forecast());
  } });
  client.configure(settings()); await tick();
  assert.equal(latest.forecast.current.temperature_2m, 12); assert.equal(latest.airError, true); assert.equal(timers.tasks.size, 1);
  client.configure(settings({ scale: 2 })); assert.equal(calls, 2);
  mode = 'good'; await client.refresh(); assert.equal(latest.air.aqi, 20); assert.equal(timers.tasks.size, 1);
  mode = 'fail'; await client.refresh(); assert.equal(latest.forecastError, true); assert.equal(latest.forecastUpdated, 123); assert.equal(latest.air.aqi, 20);
  client.setVisible(false); assert.equal(timers.tasks.size, 0);
  client.setVisible(true); await tick(); assert.equal(timers.tasks.size, 1);
  client.configure(settings({ location: null })); assert.equal(latest.forecast, null); assert.equal(timers.tasks.size, 0); client.dispose();
});

test('late weather results cannot overwrite a changed location', async () => {
  const timers = scheduler(); const pending = []; let latest;
  const client = createWeatherController({ ...timers, onChange: (state) => { latest = state; }, fetchImpl: (url) => new Promise((resolve) => pending.push({ url, resolve })) });
  client.configure(settings()); client.configure(settings({ location: { label: 'Tokyo', latitude: 35, longitude: 139 } }));
  for (const item of pending.slice(2)) item.resolve(response(item.url.hostname.startsWith('air-') ? { current: { us_aqi: 30 } } : { ...forecast(), current: { ...forecast().current, temperature_2m: 25 } }));
  await tick(); assert.equal(latest.forecast.current.temperature_2m, 25);
  for (const item of pending.slice(0, 2)) item.resolve(response(item.url.hostname.startsWith('air-') ? { current: { us_aqi: 1 } } : forecast()));
  await tick(); assert.equal(latest.forecast.current.temperature_2m, 25); assert.equal(latest.air.aqi, 30); assert.equal(timers.tasks.size, 1); client.dispose();
});

test('photo owner skips failed images, cancels timers, and revokes replaced URLs after clearing', async () => {
  const timers = scheduler(); const events = []; const shown = [];
  const client = createPhotoController({ ...timers, createUrl: (file) => file.name, revokeUrl: (url) => events.push(`revoke:${url}`), clear: () => events.push('clear'), report: (message) => events.push(message), show: (photo) => shown.push(photo.url), decode: async (url) => { if (url === 'bad') throw new Error('decode'); } });
  const file = (name) => ({ name, size: 1, type: 'image/png' });
  client.configure(settings({ order: 'name' })); client.select([file('bad'), file('good'), file('other')]); await tick();
  assert.deepEqual(shown, ['good']); assert.equal(timers.tasks.size, 1);
  client.setVisible(false); assert.equal(timers.tasks.size, 0);
  client.setVisible(true); await tick(); assert.equal(timers.tasks.size, 1);
  events.length = 0; client.select([file('single')]); await tick(); assert.equal(events[0], 'clear'); assert.ok(events.includes('revoke:good')); assert.equal(timers.tasks.size, 0);
  client.dispose(); assert.ok(events.includes('revoke:single'));
});

test('a photo decoding after replacement cannot be displayed', async () => {
  const pending = []; const shown = [];
  const client = createPhotoController({ createUrl: (file) => file.name, revokeUrl() {}, clear() {}, report() {}, show: (photo) => shown.push(photo.url), decode: () => new Promise((resolve) => pending.push(resolve)) });
  client.configure(settings()); client.select([{ name: 'old', size: 1, type: 'image/png' }]); client.select([{ name: 'new', size: 1, type: 'image/png' }]);
  pending[1](); await tick(); pending[0](); await tick(); assert.deepEqual(shown, ['new']); client.dispose();
});
