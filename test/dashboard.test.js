import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDashboardServer } from '../src/app.js';
import { clockText, loadSettings, normalizeSettings, orderPhotos, sampleHours, temperatureRange, weatherIconFile } from '../public/dashboard-helpers.js';
import { createWeatherController, normalizeForecast, requestJson, searchLocations, weatherUrls } from '../public/dashboard-weather.js';
import { createPhotoController } from '../public/dashboard-photos.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settings = (extra = {}) => normalizeSettings({ location: { latitude: 51, longitude: 0, label: 'London' }, timezone: 'Europe/London', ...extra });
const forecast = () => ({ current: { time: 1727740800, temperature_2m: 12, weather_code: 0, is_day: 1 }, current_units: { temperature_2m: '°C' }, utc_offset_seconds: 3600, hourly: { time: [1727740800], temperature_2m: [12], weather_code: [0], is_day: [0] }, daily: { time: [1727737200], temperature_2m_min: [8], temperature_2m_max: [15], weather_code: [2] } });
const response = (data) => ({ ok: true, json: async () => data });
function scheduler() {
  const tasks = new Map(); let id = 0;
  return { tasks, schedule(fn, delay) { tasks.set(++id, { fn, delay }); return id; }, cancel(key) { tasks.delete(key); } };
}

async function staticServer(context) {
  const server = createDashboardServer({ runtimeConfig: {}, store: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves the photo dashboard at home and index without the retired widget interface', async (context) => {
  const base = await staticServer(context);
  let homeDocument;
  for (const route of ['/', '/index.html']) {
    const result = await fetch(base + route);
    assert.equal(result.status, 200, route);
    assert.match(result.headers.get('content-type'), /text\/html/);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    const html = await result.text();
    assert.match(html, /src="\/dashboard.js"/);
    assert.match(html, /href="\/dashboard.css"/);
    assert.doesNotMatch(html, /src="\/app.js"|href="\/"|href="\/dashboard"|id="home-|legacy-integration-controls|widget-(?:move|resize)|id="(?:device|linkwarden|home-assistant)-dialog"/);
    for (const id of ['photos', 'information', 'clock', 'weather', 'calendar', 'open-settings', 'fullscreen', 'settings-dialog']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `expected one #${id}`);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'element IDs are unique');
    if (homeDocument) assert.equal(html, homeDocument); else homeDocument = html;
  }
});

test('redirects only legacy dashboard documents to the canonical home URL', async (context) => {
  const base = await staticServer(context);
  const homeDocument = await (await fetch(base)).text();
  for (const route of ['/dashboard', '/dashboard/', '/dashboard.html', '/dashboard?old=1']) {
    const redirect = await fetch(base + route, { redirect: 'manual' });
    assert.equal(redirect.status, 308, route);
    assert.equal(redirect.headers.get('location'), '/', route);
    assert.equal(redirect.headers.get('cache-control'), 'no-store');
    assert.equal(redirect.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await redirect.text(), '');
    const result = await fetch(base + route);
    assert.equal(result.status, 200);
    assert.equal(result.url, `${base}/`, route);
    assert.equal(await result.text(), homeDocument, route);
  }
});

test('serves retained dashboard assets with their MIME and cache headers', async (context) => {
  const base = await staticServer(context);
  for (const name of ['dashboard.js', 'dashboard-helpers.js', 'dashboard-weather.js', 'dashboard-photos.js', 'dashboard-calendar.js', 'dashboard.css', 'home-layout.js']) {
    const result = await fetch(`${base}/${name}`); assert.equal(result.status, 200); assert.match(result.headers.get('content-type'), name.endsWith('.css') ? /text\/css/ : /text\/javascript/); assert.equal(result.headers.get('cache-control'), name.endsWith('.js') ? 'no-store' : 'no-cache'); assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('returns not found for retired widget assets and paths outside the public directory', async (context) => {
  const base = await staticServer(context);
  const retired = ['app.js', 'app-helpers.js', 'styles.css', 'home-settings.js', 'home-widgets.js', 'home-information.js', 'home-integrations.js', 'home-shell.js', 'home-responsive.js'];
  for (const route of [...retired.map((name) => `/${name}`), '/missing', '/dashboard/missing', '/%2e%2e/package.json', '/..%2fpackage.json', '/src/app.js']) assert.equal((await fetch(base + route, { redirect: 'manual' })).status, 404, route);
});

test('serves the bounded local weather icon collection', async (context) => {
  const base = await staticServer(context);
  const iconFiles = ['weather-cloudy.svg', 'weather-fog.svg', 'weather-lightning-rainy.svg', 'weather-lightning.svg', 'weather-night-partly-cloudy.svg', 'weather-night.svg', 'weather-partly-cloudy.svg', 'weather-pouring.svg', 'weather-rainy.svg', 'weather-snowy-rainy.svg', 'weather-snowy.svg', 'weather-sunny.svg'];
  assert.deepEqual(readdirSync(new URL('../public/weather-icons/', import.meta.url)).sort(), iconFiles);
  for (const name of iconFiles) {
    const iconResponse = await fetch(`${base}/weather-icons/${name}`); assert.equal(iconResponse.status, 200); assert.match(iconResponse.headers.get('content-type'), /image\/svg\+xml/);
    const icon = await iconResponse.text(); assert.match(icon, /^<svg[^>]*viewBox="0 0 24 24"><path d="[^"]+" \/><\/svg>$/); assert.doesNotMatch(icon, /<script|<text|<animate|<foreignObject|xlink:href|\shref=/i);
  }
  assert.equal((await fetch(`${base}/weather-icons.svg`)).status, 404); assert.equal((await fetch(`${base}/weather-icons/snowflake.svg`)).status, 404);
});

test('home preserves forecast, calendar, and photo settings markup', async (context) => {
  const base = await staticServer(context);
  const dashboardHtml = await (await fetch(base)).text(); assert.match(dashboardHtml, /<img id="weather-icon"[^>]*alt=""[^>]*aria-hidden="true"[^>]*hidden>/);
  assert.match(dashboardHtml, /NFS backgrounds/); assert.doesNotMatch(dashboardHtml, /id="photo-files"|Choose photos|Reselect/);
  assert.match(dashboardHtml, /id="hourly" aria-label="Hourly forecast"/); assert.match(dashboardHtml, /id="daily" aria-label="Daily forecast"/);
  assert.match(dashboardHtml, /id="calendar-events"/); assert.match(dashboardHtml, /id="calendar-password"[^>]*type="password"[^>]*autocomplete="current-password"/);
  assert.doesNotMatch(dashboardHtml, /refresh-calendar|>Refresh<|calendar-heading/);
  assert.match(dashboardHtml, /Baikal server URL/); assert.match(dashboardHtml, /name="serverUrl"[^>]*placeholder="https:\/\/baikal\.example\.test"/); assert.doesNotMatch(dashboardHtml, /dav\.php\/calendars/);
});

test('dashboard styles preserve transparent, wrapping forecasts and calendar presentation', async (context) => {
  const base = await staticServer(context);
  const dashboardCss = await (await fetch(`${base}/dashboard.css`)).text(); assert.match(dashboardCss, /#weather \{[^}]*background: transparent;[^}]*border-radius: 0;/); assert.doesNotMatch(dashboardCss, /#weather \{[^}]*#08101bcc/);
  assert.match(dashboardCss, /#information \{[^}]*width: calc\(100% - 2rem\);[^}]*max-width: none;/); assert.doesNotMatch(dashboardCss, /max-width: min\(55rem/);
  assert.match(dashboardCss, /:fullscreen \.page-tools \{ display: none; \}/);
  assert.match(dashboardCss, /#hourly li, #daily li \{[^}]*background: transparent;/);
  assert.match(dashboardCss, /#hourly, #daily \{[^}]*flex-wrap: wrap;[^}]*max-width: 70%;/); assert.doesNotMatch(dashboardCss, /#hourly, #daily \{[^}]*overflow-[xy]:\s*auto/);
  assert.match(dashboardCss, /#hourly li, #daily li \{[^}]*flex: 1 1 6\.25em;[^}]*min-width: min\(6\.25em, 100%\);/); assert.doesNotMatch(dashboardCss, /flex: 0 0 8em/);
  assert.match(dashboardCss, /#hourly li:only-child, #daily li:only-child \{[^}]*flex-basis: 100%;/);
  assert.match(dashboardCss, /\.forecast-item \{[^}]*flex-direction: column;/);
  assert.match(dashboardCss, /\.forecast-label, \.forecast-temperature, \.forecast-condition \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(dashboardCss, /@media \(max-width: 600px\) \{[\s\S]*#hourly, #daily \{ gap: \.1rem; \}/);
  assert.match(dashboardCss, /\.weather-icon \{[^}]*filter: brightness\(0\) invert\(1\) drop-shadow/);
  assert.match(dashboardCss, /\.forecast-icon \{[^}]*width: clamp[^}]*filter: brightness\(0\) invert\(1\) drop-shadow/);
  assert.match(dashboardCss, /#calendar \{[^}]*background: transparent;/); assert.match(dashboardCss, /\.calendar-event \{[^}]*background: transparent;/);
  assert.doesNotMatch(dashboardCss, /calendar-heading/);
});

test('dashboard modules preserve local icons and automatic calendar refresh', async (context) => {
  const base = await staticServer(context);
  const dashboardJs = await (await fetch(`${base}/dashboard.js`)).text(); assert.match(dashboardJs, /`\/weather-icons\/\$\{weatherIconFile\(/); assert.match(dashboardJs, /icon\.hidden = true; icon\.removeAttribute\('src'\)/); assert.match(dashboardJs, /icon\.alt = ''; icon\.setAttribute\('aria-hidden', 'true'\)/); assert.match(dashboardJs, /forecastItem\(\{ code: hour\.code, day: hour\.day/); assert.match(dashboardJs, /forecastItem\(\{ code: day\.code, label/); assert.match(dashboardJs, /weatherDescription\(code, day\)/); assert.doesNotMatch(dashboardJs, /innerHTML|weather-icons\.svg/);
  assert.doesNotMatch(dashboardJs, /refresh-calendar|forceRefresh/);
  const calendarJs = await (await fetch(`${base}/dashboard-calendar.js`)).text(); assert.doesNotMatch(calendarJs, /forceRefresh|\?refresh=1/);
});

test('serves an injected NFS photo snapshot only through protected API routes', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-photo-api-'));
  const imagePath = path.join(directory, 'photo.png'); writeFileSync(imagePath, 'image-data');
  const token = 'abcdefghijklmnop';
  const photoLibrary = {
    list: async () => ({ available: true, photos: [{ name: 'photo.png', lastModified: 1, url: `/api/dashboard/photos/${token}` }] }),
    open: async (value) => value === token ? { stream: Readable.from('image-data'), mime: 'image/png', size: 10 } : null
  };
  const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store: {}, photoLibrary });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const manifest = await fetch(`${base}/api/dashboard/photos`);
  assert.deepEqual(await manifest.json(), { available: true, photos: [{ name: 'photo.png', lastModified: 1, url: `/api/dashboard/photos/${token}` }] });
  assert.equal(manifest.headers.get('cache-control'), 'no-store');
  const image = await fetch(`${base}/api/dashboard/photos/${token}`);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff'); assert.equal(await image.text(), 'image-data');
  assert.equal((await fetch(`${base}/api/dashboard/photos/unknownunknownunk`)).status, 404);
  assert.equal((await fetch(`${base}/api/dashboard/photos/${token}`, { method: 'POST' })).status, 404);
});

test('maps bounded WMO conditions to local weather icons', () => {
  const cases = [
    [0, 1, 'weather-sunny.svg'], [0, 0, 'weather-night.svg'], [1, 1, 'weather-partly-cloudy.svg'], [2, 0, 'weather-night-partly-cloudy.svg'], [3, 1, 'weather-cloudy.svg'],
    [45, 1, 'weather-fog.svg'], [48, 1, 'weather-fog.svg'], [51, 1, 'weather-rainy.svg'], [55, 1, 'weather-rainy.svg'], [56, 1, 'weather-snowy-rainy.svg'], [67, 1, 'weather-snowy-rainy.svg'],
    [61, 1, 'weather-rainy.svg'], [63, 1, 'weather-rainy.svg'], [65, 1, 'weather-pouring.svg'], [80, 1, 'weather-rainy.svg'], [81, 1, 'weather-rainy.svg'], [82, 1, 'weather-pouring.svg'],
    [71, 1, 'weather-snowy.svg'], [77, 1, 'weather-snowy.svg'], [85, 1, 'weather-snowy.svg'], [86, 1, 'weather-snowy.svg'],
    [95, 1, 'weather-lightning.svg'], [96, 1, 'weather-lightning-rainy.svg'], [99, 1, 'weather-lightning-rainy.svg'], [4, 1, 'weather-cloudy.svg'], [null, 1, 'weather-cloudy.svg'], ['0', 1, 'weather-cloudy.svg'], [NaN, 1, 'weather-cloudy.svg'], [Infinity, 1, 'weather-cloudy.svg']
  ];
  for (const [code, day, expected] of cases) assert.equal(weatherIconFile(code, day), expected, `${code}/${day}`);
  assert.equal(weatherIconFile(1, null), 'weather-partly-cloudy.svg');
});

test('recovers preferences and constrains untrusted persisted settings', () => {
  for (const storage of [undefined, { getItem() { throw new Error('blocked'); } }, { getItem: () => '{bad' }, { getItem: () => 'null' }]) assert.equal(loadSettings(storage).interval, 60);
  const result = normalizeSettings({ scale: 100, duration: 50, interval: 5, timeScale: NaN, calendarScale: 9, opacity: -1, timezone: 'not/a/zone', location: { latitude: 999, longitude: 0 }, color: 'url(x)', extra: 'discard', weatherVisible: 'false', calendarVisible: 'false' }, 'UTC');
  assert.equal(result.scale, 2); assert.equal(result.duration, 4); assert.equal(result.timeScale, 1); assert.equal(result.calendarScale, 2); assert.equal(result.opacity, 0); assert.equal(result.timezone, 'UTC'); assert.equal(result.location, null); assert.equal(result.color, '#000000'); assert.equal(result.weatherVisible, true); assert.equal(result.calendarVisible, true); assert.equal(result.extra, undefined);
});

test('formats clock across timezone date boundaries and daylight saving', () => {
  const instant = new Date('2026-01-01T00:30:00Z');
  assert.equal(clockText(instant, settings({ timezone: 'America/Los_Angeles', dateStyle: 'short' }), 'en-US').date, '12/31/25');
  assert.match(clockText(instant, settings({ timezone: 'Asia/Tokyo' }), 'en-GB').time, /09:30:00/);
  const summer = clockText(new Date('2026-07-01T12:00:00Z'), settings(), 'en-GB'); assert.equal(summer.time, '13:00:00');
});

test('formats compact daily temperature ranges without unit spaces', () => {
  assert.equal(temperatureRange(16.2, 26.4, '°C'), '16.2°C/26.4°C');
  assert.equal(temperatureRange(-4, 7, '°F'), '-4°F/7°F');
});

test('provides deterministic photo ordering without mutating input', () => {
  const file = (name, size = 1, type = 'image/png', lastModified = 0) => ({ name, size, type, lastModified });
  const photos = [{ file: file('z', 1, 'image/png', 1) }, { file: file('a', 1, 'image/png', 2) }];
  assert.equal(orderPhotos(photos, 'name')[0].file.name, 'a'); assert.equal(orderPhotos(photos, 'date')[0].file.name, 'z'); assert.equal(photos[0].file.name, 'z');
  assert.equal(orderPhotos(photos, 'random', () => 0)[0].file.name, 'a');
});

test('samples future hours with gaps, exhausted forecasts, and daily offset dates', () => {
  const rows = [0, 3600, 7200, 14400, 25200, 90000].map((time, index) => ({ time, day: index % 2 }));
  assert.deepEqual(sampleHours(rows, 1000).map((row) => [row.time, row.day]), [[14400, 1], [25200, 0]]);
  assert.equal(sampleHours(Array.from({ length: 30 }, (_, index) => ({ time: 3600 + index * 10800, day: index % 2 })), 1000).length, 7);
  assert.deepEqual(sampleHours(rows, 100000000), []);
  const normalized = normalizeForecast(forecast()); assert.equal(normalized.daily[0].date, '2024-10-01'); assert.deepEqual(normalized.hourly[0], { time: 1727740800, temperature: 12, code: 0, day: 0 });
  const hourly = { time: [1727740800, 1727744400, 1727748000, 1727751600], temperature_2m: [12, 13, 14, 15], weather_code: [0, 1], is_day: [1, 0, '1', 2] };
  assert.deepEqual(normalizeForecast({ ...forecast(), hourly }).hourly.map(({ code, day }) => ({ code, day })), [{ code: 0, day: 1 }, { code: 1, day: 0 }, { code: null, day: null }, { code: null, day: null }]);
  assert.equal(normalizeForecast({ ...forecast(), hourly: { time: [1727740800], temperature_2m: [12] } }).hourly[0].day, null);
  assert.throws(() => normalizeForecast({ current: { temperature_2m: '12' } }));
  assert.equal(normalizeForecast({ ...forecast(), hourly: { time: [1727740800], temperature_2m: [null] } }).hourly.length, 0);
});

test('constructs bounded provider queries and normalizes geocoding', async () => {
  const urls = weatherUrls(settings({ temperature: 'fahrenheit', wind: 'kn', precipitation: 'inch' }));
  assert.equal(urls.forecast.hostname, 'api.open-meteo.com'); assert.equal(urls.forecast.searchParams.get('timeformat'), 'unixtime'); assert.equal(urls.forecast.searchParams.get('wind_speed_unit'), 'kn'); assert.equal(urls.forecast.searchParams.get('precipitation_unit'), 'inch'); assert.deepEqual(urls.forecast.searchParams.get('hourly').split(','), ['temperature_2m', 'weather_code', 'is_day']); assert.equal(urls.forecast.searchParams.getAll('hourly').length, 1); assert.equal(urls.air.searchParams.get('current'), 'us_aqi');
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

test('photo owner skips failed server images and cancels timers after replacement', async () => {
  const timers = scheduler(); const events = []; const shown = [];
  const client = createPhotoController({ ...timers, clear: () => events.push('clear'), report: (message) => events.push(message), show: (photo) => shown.push(photo.url), decode: async (url) => { if (url === 'bad') throw new Error('decode'); } });
  const photo = (name) => ({ file: { name, lastModified: 1 }, url: name });
  client.configure(settings({ order: 'name' })); client.replace([photo('bad'), photo('good'), photo('other')]); await tick();
  assert.deepEqual(shown, ['good']); assert.equal(timers.tasks.size, 1);
  client.setVisible(false); assert.equal(timers.tasks.size, 0);
  client.setVisible(true); await tick(); assert.equal(timers.tasks.size, 1);
  events.length = 0; client.replace([photo('single')]); await tick(); assert.equal(events[0], 'clear'); assert.equal(timers.tasks.size, 0);
  client.dispose(); assert.equal(events.at(-1), 'clear');
});

test('a photo decoding after replacement cannot be displayed', async () => {
  const pending = []; const shown = [];
  const client = createPhotoController({ clear() {}, report() {}, show: (photo) => shown.push(photo.url), decode: () => new Promise((resolve) => pending.push(resolve)) });
  client.configure(settings()); client.replace([{ file: { name: 'old', lastModified: 1 }, url: 'old' }]); client.replace([{ file: { name: 'new', lastModified: 1 }, url: 'new' }]);
  pending[1](); await tick(); pending[0](); await tick(); assert.deepEqual(shown, ['new']); client.dispose();
});

test('loads normalized NFS records and ignores a late manifest response', async () => {
  const requests = []; const shown = []; const reports = [];
  const client = createPhotoController({ clear() {}, report: (message) => reports.push(message), show: (photo) => shown.push(photo.url), decode: async () => {}, fetchImpl: (_url, options) => new Promise((resolve) => requests.push({ resolve, signal: options.signal })) });
  client.configure(settings({ order: 'name' }));
  const first = client.load(); const second = client.load();
  requests[1].resolve(response({ available: true, photos: [{ name: 'new.png', lastModified: 2, url: '/api/dashboard/photos/abcdefghijklmnop' }, { name: '../bad', lastModified: 1, url: '/outside' }] }));
  await second; await tick();
  requests[0].resolve(response({ available: true, photos: [{ name: 'old.png', lastModified: 1, url: '/api/dashboard/photos/ponmlkjihgfedcba' }] }));
  await first; await tick();
  assert.deepEqual(shown, ['/api/dashboard/photos/abcdefghijklmnop']);
  assert.equal(reports.at(-1), '1 NFS backgrounds loaded.');
  client.dispose();
});

test('bounds a stalled NFS manifest request and reports the fallback', async () => {
  const reports = []; let abort;
  const client = createPhotoController({ clear() {}, report: (message) => reports.push(message), show() {}, requestSchedule: (fn) => { abort = fn; return 1; }, requestCancel() {}, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })) });
  client.configure(settings()); const pending = client.load(); abort(); await pending;
  assert.equal(reports.at(-1), 'NFS backgrounds could not be loaded. The dashboard will continue without photos.');
  client.dispose();
});
