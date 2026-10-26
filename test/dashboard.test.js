import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDashboardServer } from '../src/app.js';
import { MOBILE_MEDIA_QUERY, clockText, loadSettings, normalizeSettings, resolveDisplayPreferences, sampleHours, temperatureRange, weatherIconFile } from '../public/dashboard-helpers.js';
import { createWeatherController, requestJson, searchLocations } from '../public/dashboard-weather.js';
import { formatWeatherUpdated, normalizeAir, normalizeForecast, presentForecast, validateWeatherSnapshot } from '../public/weather-data.js';
import { rawAir } from './fixtures/weather.js';
import { weatherUrls } from '../src/weather.js';
import { createPhotoController } from '../public/dashboard-photos.js';
import { photo, slideshowSnapshot, snapshotResponse, slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred } from './fixtures/lifecycle.js';

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
    assert.doesNotMatch(html, /src="\/app.js"|href="\/"|href="\/dashboard"|id="home-(?!assistant-)|legacy-integration-controls|widget-(?:move|resize)|id="(?:device|linkwarden|home-assistant)-dialog"/);
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
  for (const name of ['dashboard.js', 'dashboard-helpers.js', 'dashboard-layout-automatic.js', 'dashboard-layout-editor.js', 'dashboard-weather.js', 'weather-data.js', 'dashboard-photos.js', 'dashboard-calendar.js', 'dashboard-settings.js', 'dashboard-configuration.js', 'dashboard-home-assistant.js', 'dashboard-wol.js', 'dashboard-integration-settings.js', 'bookmark-data.js', 'bookmark-selection-data.js', 'dashboard-bookmarks.js', 'dashboard-bookmark-selection.js', 'dashboard-bookmark-list.js', 'dashboard.css', 'home-layout.js']) {
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

test('Settings links eight accessible tabs to panels with General initially selected', async (context) => {
  const base = await staticServer(context);
  const html = await (await fetch(base)).text();
  assert.match(html, /role="tablist"[^>]*aria-label="Settings categories"[^>]*aria-orientation="vertical"/);
  const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual(tabs.map((tab) => tab[1]), ['General', 'Time', 'Weather', 'Calendar', 'Bookmarks', 'Home Assistant', 'Wake-on-LAN', 'Images']);
  assert.equal([...html.matchAll(/role="tabpanel"/g)].length, 8);
  for (const tab of tabs) {
    const name = tab[1] === 'Wake-on-LAN' ? 'wol' : tab[1].toLowerCase().replaceAll(' ', '-');
    const selected = name === 'general';
    assert.match(tab[0], new RegExp(`id="settings-tab-${name}"`));
    assert.match(tab[0], new RegExp(`aria-controls="settings-panel-${name}"`));
    assert.match(tab[0], new RegExp(`aria-selected="${selected}"`));
    assert.match(tab[0], new RegExp(`tabindex="${selected ? 0 : -1}"`));
    const panel = html.match(new RegExp(`<section id="settings-panel-${name}"[^>]*>`))?.[0];
    assert.ok(panel, `${name} panel exists`);
    assert.match(panel, new RegExp(`role="tabpanel"[^>]*aria-labelledby="settings-tab-${name}"`));
    assert.equal(/\shidden/.test(panel), !selected, `${name} initial visibility`);
  }
  const general = html.slice(html.indexOf('<section id="settings-panel-general"'), html.indexOf('<section id="settings-panel-time"'));
  assert.doesNotMatch(html, /Information layout|name="position"|name="scale"/);
  for (const id of ['export-global-settings', 'import-global-settings', 'reset-category-scopes']) assert.match(general, new RegExp(`id="${id}"`));
});

test('Settings associates all preferences with one form and keeps service forms separate', async (context) => {
  const base = await staticServer(context);
  const html = await (await fetch(base)).text();
  assert.match(html, /<form id="preferences" novalidate hidden><\/form>/);
  const controls = [...html.matchAll(/<(?:input|select)\b[^>]*form="preferences"[^>]*>/g)];
  const names = controls.map((control) => /name="([^"]+)"/.exec(control[0])?.[1]);
  assert.deepEqual(names.sort(), [...Object.keys(normalizeSettings()).filter((name) => !['location', 'position', 'scale', 'homeAssistantDeviceSelections', 'bookmarkLinkSelections', 'widgetLayout'].includes(name)), 'followGlobalPhotos'].sort());
  assert.equal(Object.hasOwn(normalizeSettings(), 'followGlobalPhotos'), false, 'Local playback choice is not a shared preference');
  assert.doesNotMatch(html, /id="widget-layout-editor"|id="layout-preview"/);
  assert.match(html, /id="layout-toolbar"/);
  assert.match(html, /id="edit-layout"/);
  for (const id of ['layout-toolbar', 'layout-form', 'layout-frames', 'layout-profile', 'layout-widget', 'layout-x', 'layout-save', 'layout-toggle', 'layout-details', 'layout-close', 'layout-layers']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} is unique`);
  assert.match(html, /id="layout-toggle" type="button" aria-expanded="false" aria-controls="layout-details"/);
  assert.match(html, /id="layout-details"[^>]*aria-label="Layout editing controls"[^>]*hidden/);
  assert.match(html, /id="layout-close" type="button"/);
  const layoutForm = html.match(/<form id="layout-form"[\s\S]*?<\/form>/)?.[0];
  assert.ok(layoutForm); assert.doesNotMatch(layoutForm, /form="preferences"/); assert.match(layoutForm, /id="layout-save" type="submit"/);
  assert.match(html, /id="bookmark-link-picker"/);
  assert.match(html, /id="home-assistant-device-picker"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*form="preferences"[^>]*>Save preferences<\/button>/);
  for (const id of ['location-search', 'calendar-connection', 'linkwarden-connection']) {
    const form = html.match(new RegExp(`<form id="${id}">[\\s\\S]*?<\\/form>`))?.[0];
    assert.ok(form, `${id} exists`);
    assert.equal([...form.matchAll(/<form\b/g)].length, 1, `${id} has no nested form`);
    assert.doesNotMatch(form, /form="preferences"/);
  }
});

test('dashboard styles preserve transparent, wrapping forecasts and calendar presentation', async (context) => {
  const base = await staticServer(context);
  const dashboardCss = await (await fetch(`${base}/dashboard.css`)).text(); assert.match(dashboardCss, /#weather \{[^}]*background: transparent;[^}]*border-radius: 0;/); assert.doesNotMatch(dashboardCss, /#weather \{[^}]*#08101bcc/);
  assert.match(dashboardCss, /#information \{[^}]*width: calc\(100% - 2rem\);[^}]*max-width: none;/); assert.doesNotMatch(dashboardCss, /max-width: min\(55rem/);
  assert.match(dashboardCss, /:fullscreen \.page-tools \{ display: none; \}/);
  assert.match(dashboardCss, /:fullscreen #edit-layout \{ display: none; \}/);
  assert.match(dashboardCss, /#hourly li, #daily li \{[^}]*background: transparent;/);
  assert.match(dashboardCss, /#hourly, #daily \{[^}]*flex-wrap: wrap;[^}]*max-width: 70%;/); assert.doesNotMatch(dashboardCss, /#hourly, #daily \{[^}]*overflow-[xy]:\s*auto/);
  assert.match(dashboardCss, /#hourly li, #daily li \{[^}]*flex: 1 1 6\.25em;[^}]*min-width: min\(6\.25em, 100%\);/); assert.doesNotMatch(dashboardCss, /flex: 0 0 8em/);
  assert.match(dashboardCss, /#hourly li:only-child, #daily li:only-child \{[^}]*flex-basis: 100%;/);
  assert.match(dashboardCss, /\.forecast-item \{[^}]*flex-direction: column;/);
  assert.match(dashboardCss, /\.forecast-label, \.forecast-temperature, \.forecast-condition \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(dashboardCss, /@media \(max-width: 600px\) \{[\s\S]*#hourly, #daily \{ gap: \.1rem; max-width: 100%; \}/);
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

test('legacy preferences gain independent mobile defaults without rewriting stored desktop values', () => {
  const legacy = { timeVisible: false, weatherVisible: false, calendarVisible: false, timeScale: 0.8, weatherScale: 1.2, calendarScale: 1.5, scale: 2, position: 'right' };
  const raw = JSON.stringify(legacy); let writes = 0;
  const value = loadSettings({ getItem: () => raw, setItem: () => writes++ });
  for (const view of ['Time', 'Weather', 'Calendar']) {
    assert.equal(value[`mobile${view}Visible`], true, `${view} mobile visibility defaults independently`);
    assert.equal(value[`mobile${view}Scale`], 1, `${view} mobile scale defaults independently`);
  }
  for (const [key, saved] of Object.entries(legacy)) assert.equal(value[key], saved, `${key} is preserved`);
  assert.equal(writes, 0, 'loading normalized defaults does not save storage');
});

test('mobile fields use strict booleans and finite clamped scales matching the form step', () => {
  const values = [[undefined, 1], [null, 1], ['1.2', 1], [NaN, 1], [Infinity, 1], [-Infinity, 1], [-3, 0.5], [9, 2], [1.25, 1.3], [1.11, 1.1], [0.55, 0.6], [0.5, 0.5], [2, 2]];
  for (const view of ['Time', 'Weather', 'Calendar']) {
    for (const [input, expected] of values) assert.equal(normalizeSettings({ [`mobile${view}Scale`]: input })[`mobile${view}Scale`], expected, `${view} scale ${String(input)}`);
    for (const input of ['false', 0, null, undefined]) assert.equal(normalizeSettings({ [`mobile${view}Visible`]: input })[`mobile${view}Visible`], true, `${view} rejects non-boolean visibility`);
    assert.equal(normalizeSettings({ [`mobile${view}Visible`]: false })[`mobile${view}Visible`], false);
  }
  assert.equal(normalizeSettings({ timeScale: 1.25 }).timeScale, 1.25, 'desktop scale normalization remains unchanged');
});

test('display projection selects independent profiles without mutating saved preferences', () => {
  const value = normalizeSettings({ position: 'right', scale: 2, timeVisible: false, timeScale: 1.5, weatherVisible: true, weatherScale: 0.5, calendarVisible: false, calendarScale: 1.8, mobileTimeVisible: true, mobileTimeScale: 0.7, mobileWeatherVisible: false, mobileWeatherScale: 1.3, mobileCalendarVisible: true, mobileCalendarScale: 2 });
  const before = structuredClone(value);
  assert.deepEqual(resolveDisplayPreferences(value, true), { position: 'left', scale: 1, timeVisible: true, timeScale: 0.7, weatherVisible: false, weatherScale: 1.3, calendarVisible: true, calendarScale: 2, bookmarksVisible: true, homeAssistantVisible: true, wolVisible: true });
  assert.deepEqual(resolveDisplayPreferences(value, false), { position: 'right', scale: 2, timeVisible: false, timeScale: 1.5, weatherVisible: true, weatherScale: 0.5, calendarVisible: false, calendarScale: 1.8, bookmarksVisible: true, homeAssistantVisible: true, wolVisible: true });
  assert.deepEqual(value, before, 'projection cannot overwrite either profile');
  assert.equal(MOBILE_MEDIA_QUERY, '(max-width: 600px)');
});

test('Settings separates profile visibility and scale from shared format and units', async (context) => {
  const html = await (await fetch(await staticServer(context))).text();
  for (const [panel, view] of [['time', 'Time'], ['weather', 'Weather'], ['calendar', 'Calendar']]) {
    const markup = html.match(new RegExp(`<section id="settings-panel-${panel}"[\\s\\S]*?<\\/section>`))[0];
    const fields = [...markup.matchAll(/<fieldset><legend>([^<]+)<\/legend>([\s\S]*?)<\/fieldset>/g)];
    const names = (legend) => [...fields.find((field) => field[1] === legend)[2].matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(names('Desktop display').sort(), [`${panel}Scale`, `${panel}Visible`].sort());
    assert.deepEqual(names('Mobile display').sort(), [`mobile${view}Scale`, `mobile${view}Visible`].sort());
    if (panel === 'time') assert.deepEqual(names('Shared format'), ['timezone', 'dateStyle', 'hour12', 'seconds']);
    if (panel === 'weather') assert.deepEqual(names('Shared units'), ['temperature', 'wind', 'precipitation']);
    assert.match(markup, new RegExp(`name="mobile${view}Scale"[^>]*form="preferences"[^>]*min="0.5"[^>]*max="2"[^>]*step="0.1"`));
  }
  const general = html.match(/<section id="settings-panel-general"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(general, /name="(?:mobile)?(?:time|weather|calendar|bookmarks|homeAssistant|wol)Visible"/i);
  for (const profile of ['', 'mobile']) for (const section of ['time', 'weather', 'calendar', 'bookmarks', 'homeAssistant', 'wol']) {
    const name = `${profile}${profile ? section[0].toUpperCase() + section.slice(1) : section}Visible`;
    assert.equal([...html.matchAll(new RegExp(`name="${name}"`, 'g'))].length, 1);
    const category = section === 'homeAssistant' ? 'home-assistant' : section;
    const markup = html.match(new RegExp(`<section id="settings-panel-${category}"[\\s\\S]*?<\\/section>`))[0];
    assert.match(markup, new RegExp(`name="${name}" form="preferences" type="checkbox"`));
  }
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
  const urls = weatherUrls(settings().location, settings().timezone);
  assert.equal(urls.forecast.hostname, 'api.open-meteo.com'); assert.equal(urls.forecast.searchParams.get('timeformat'), 'unixtime'); assert.equal(urls.forecast.searchParams.get('wind_speed_unit'), 'kmh'); assert.equal(urls.forecast.searchParams.get('precipitation_unit'), 'mm'); assert.deepEqual(urls.forecast.searchParams.get('hourly').split(','), ['temperature_2m', 'weather_code', 'is_day']); assert.equal(urls.forecast.searchParams.getAll('hourly').length, 1); assert.equal(urls.air.searchParams.get('current'), 'us_aqi');
  const results = await searchLocations('x'.repeat(200), { fetchImpl: async (url, options) => {
    assert.equal(url.hostname, 'geocoding-api.open-meteo.com'); assert.equal(url.searchParams.get('name').length, 120); assert.equal(options.credentials, 'omit');
    return response({ results: [{ name: 'London', latitude: 51, longitude: 0 }, { name: 'Invalid', latitude: 999, longitude: 0 }] });
  } });
  assert.deepEqual(results, [{ label: 'London', latitude: 51, longitude: 0 }]);
  await assert.rejects(searchLocations('London', { fetchImpl: async () => response({ results: {} }) }));
});

test('current AQI accepts zero and rejects absent or nonnumeric provider readings', () => {
  assert.deepEqual(normalizeAir(rawAir()), { aqi: 91 });
  assert.deepEqual(normalizeAir(rawAir(0)), { aqi: 0 });
  for (const data of [{}, { current: {} }, ...[null, '91', NaN, Infinity, -Infinity].map(rawAir)]) {
    assert.throws(() => normalizeAir(data), /Invalid air quality/, JSON.stringify(data));
  }
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

function weatherSnapshot(extra = {}) {
  return { configured: true, revision: 1, location: settings().location, timezone: 'Europe/London', forecastRegistered: true, forecast: normalizeForecast(forecast()), air: { aqi: 20 }, forecastUpdated: 123, airUpdated: 123, forecastError: false, airError: false, refreshing: false, ...extra };
}

test('weather renders cached data before ensuring freshness and changes units without requests', async () => {
  const timers = scheduler(); let latest; let calls = 0; let clock = 123;
  const client = createWeatherController({ ...timers, now: () => clock, onChange: (state) => { latest = state; }, fetchImpl: async (url) => {
    calls++;
    if (url === '/api/weather/refresh') {
      assert.equal(latest.forecast.current.temperature_2m, 12, 'cached forecast already rendered');
      return response({ scheduled: true, refreshing: true });
    }
    return response(weatherSnapshot());
  } });
  client.configure(settings({ location: { label: 'Wrong local place', latitude: 0, longitude: 0 } })); await tick();
  assert.equal(latest.location.label, 'London'); assert.equal(latest.forecastUpdated, 123);
  assert.equal(timers.tasks.size, 1); assert.equal([...timers.tasks.values()][0].delay, 5000);
  client.configure(settings({ temperature: 'fahrenheit', scale: 2 }));
  assert.equal(latest.forecast.current.temperature_2m, 53.6); assert.equal(calls, 2);
  clock += 5000; await client.refresh({ ensure: false });
  assert.equal(calls, 3); assert.equal([...timers.tasks.values()][0].delay, 60000);
  client.setVisible(false); assert.equal(timers.tasks.size, 0);
  client.setVisible(true); await tick(); assert.equal(timers.tasks.size, 1);
  client.dispose(); assert.equal(timers.tasks.size, 0);
});

test('normal polling recovers an evicted timezone, but empty idle snapshots stop fast polling', async () => {
  const timers = scheduler(); let latest; let requests = 0; let clock = 0; let registered = true;
  const client = createWeatherController({ ...timers, now: () => clock, onChange: (state) => { latest = state; }, fetchImpl: async (url) => {
    if (url === '/api/weather/refresh') { requests++; registered = true; return response({ scheduled: false, refreshing: false }); }
    return response(weatherSnapshot({ forecastRegistered: registered, forecast: null, forecastUpdated: null, forecastError: true }));
  } });
  client.configure(settings()); await tick();
  assert.equal([...timers.tasks.values()][0].delay, 60000);
  registered = false; clock += 60000; await client.refresh();
  assert.equal(requests, 2); assert.equal(registered, true); assert.equal(latest.refreshing, false);
  assert.equal([...timers.tasks.values()][0].delay, 60000); client.dispose();
});

test('late Settings and polling responses cannot overwrite a newer location or timezone', async () => {
  const timers = scheduler(); const pending = []; let latest;
  const client = createWeatherController({ ...timers, onChange: (state) => { latest = state; }, fetchImpl: (url, options) => new Promise((resolve) => pending.push({ url, options, resolve })) });
  client.configure(settings()); const nextRead = client.refresh({ ensure: false });
  pending[1].resolve(response(weatherSnapshot({ revision: 2, location: { label: 'Tokyo', latitude: 35, longitude: 139 } })));
  await nextRead; pending[0].resolve(response(weatherSnapshot())); await tick();
  assert.equal(latest.location.label, 'Tokyo'); assert.equal(latest.revision, 2);
  client.configure(settings({ timezone: 'UTC' }));
  const utc = client.refresh({ ensure: false });
  pending[3].resolve(response(weatherSnapshot({ revision: 2, timezone: 'UTC' }))); await utc;
  pending[2].resolve(response(weatherSnapshot({ revision: 1, timezone: 'UTC' }))); await tick();
  assert.equal(latest.revision, 2); assert.equal(latest.timezone, 'UTC'); client.dispose();
});

test('canonical conversions preserve missing values, daily dates, and original data', () => {
  const data = normalizeForecast(forecast()); const before = structuredClone(data);
  data.current.wind_speed_10m = 18.52; data.current.precipitation = 25.4;
  const converted = presentForecast(data, settings({ temperature: 'fahrenheit', wind: 'kn', precipitation: 'inch' }));
  assert.equal(converted.current.temperature_2m, 53.6); assert.equal(converted.current.wind_speed_10m, 10); assert.equal(converted.current.precipitation, 1);
  assert.equal(converted.daily[0].min, 46.4); assert.equal(converted.hourly[0].day, 0); assert.equal(converted.daily[0].date, before.daily[0].date);
  assert.equal(data.current.temperature_2m, 12); assert.equal(data.units.temperature_2m, '°C');
  assert.equal(presentForecast(before, settings()).current.wind_speed_10m, null);
  const instant = Date.parse('2026-01-01T00:30:00Z');
  assert.match(formatWeatherUpdated(instant, settings({ timezone: 'Asia/Tokyo', hour12: false }), 'en-GB'), /1 Jan 2026.*09:30/);
  assert.match(formatWeatherUpdated(instant, settings({ timezone: 'America/Los_Angeles', hour12: false }), 'en-GB'), /31 Dec 2025.*16:30/);
  assert.equal(formatWeatherUpdated(null, settings()), '');
  assert.throws(() => validateWeatherSnapshot(weatherSnapshot({ forecastUpdated: 'now' })));
  assert.throws(() => validateWeatherSnapshot(weatherSnapshot({ forecast: {} })));
});

function photoFollower(extra = {}) {
  const clock = slideshowClock(); const shown = []; const reports = []; const clears = []; const updates = []; let state = slideshowSnapshot();
  const client = createPhotoController({ ...clock, requestSchedule: clock.schedule, requestCancel: clock.cancel, clear: () => clears.push(true), report: (message) => reports.push(message), show: (value) => shown.push(value.file.name), update: (value) => updates.push(value.file.name), decode: async () => {}, fetchImpl: async () => snapshotResponse(state), ...extra });
  client.configure(settings()); return { client, clock, shown, reports, clears, updates, setState(value) { state = value; } };
}

test('photo follower renders only server selections and deduplicates repeated snapshots and presentation changes', async () => {
  let reads = 0; let decodes = 0;
  const env = photoFollower({ fetchImpl: async (url) => { assert.equal(url, '/api/dashboard/slideshow?version=2'); reads++; return snapshotResponse(slideshowSnapshot()); }, decode: async () => { decodes++; } });
  await env.client.load(); await tick(); assert.deepEqual(env.shown, ['a.png']);
  await env.clock.advance(15_000); assert.equal(reads, 4); assert.equal(decodes, 1); assert.deepEqual(env.shown, ['a.png']); assert.equal(env.clock.timers.size, 1);
  const timers = [...env.clock.timers]; env.client.configure(settings({ imageInfo: true, interval: 5, order: 'random' })); assert.deepEqual([...env.clock.timers], timers); assert.deepEqual(env.updates, ['a.png']); env.client.dispose(); assert.equal(env.clock.timers.size, 0);
});

test('unchanged snapshot cannot restart a pending decode; new selection retires late completion', async () => {
  const pending = []; const env = photoFollower({ decode: () => { const work = deferred(); pending.push(work); return work.promise; } });
  await env.client.load(); await tick(); await env.client.load(); assert.equal(pending.length, 1);
  env.setState(slideshowSnapshot({ revision: 2, current: photo('b.png') })); await env.client.load(); await tick(); assert.equal(pending.length, 2);
  pending[1].resolve(); await tick(); pending[0].resolve(); await tick(); assert.deepEqual(env.shown, ['b.png']); env.client.dispose();
});

test('old revisions and retired instances cannot overwrite newer selection; new server instance is adopted', async () => {
  const env = photoFollower(); await env.client.load(); await tick();
  env.setState(slideshowSnapshot({ revision: 3, current: photo('b.png') })); await env.client.load(); await tick();
  env.setState(slideshowSnapshot({ revision: 2 })); await env.client.load(); await tick(); assert.deepEqual(env.shown, ['a.png', 'b.png']);
  env.setState(slideshowSnapshot({ instanceId: 'new', revision: 0, current: photo('new.png') })); await env.client.load(); await tick();
  env.setState(slideshowSnapshot({ revision: 4 })); await env.client.load(); await tick(); assert.deepEqual(env.shown, ['a.png', 'b.png', 'new.png']); env.client.dispose();
});

test('visibility and persisted-page suspension abort old reads and resume with one immediate current read', async () => {
  const pending = []; const env = photoFollower({ fetchImpl: (_url, options) => { const work = deferred(); pending.push({ ...work, signal: options.signal }); return work.promise; } });
  const first = env.client.load(); assert.equal(first, env.client.load()); await tick(); assert.equal(pending.length, 1);
  env.client.setVisible(false); assert.equal(pending[0].signal.aborted, true); assert.equal(env.clock.timers.size, 1, 'request deadline retires in finally'); await first; assert.equal(env.clock.timers.size, 0);
  env.client.setVisible(true); await tick(); pending[1].resolve(snapshotResponse(slideshowSnapshot({ revision: 2, current: photo('b.png') }))); await tick();
  pending[0].resolve(snapshotResponse(slideshowSnapshot())); await tick(); assert.deepEqual(env.shown, ['b.png']);
  env.client.dispose(); assert.equal(env.clock.timers.size, 0);
});

test('metadata and image failure retain last-good background, retry boundedly, and authoritative empty clears', async () => {
  let fail = false; let imageFail = false; let state = slideshowSnapshot(); let decodes = 0;
  const env = photoFollower({ fetchImpl: async () => { if (fail) throw new Error('offline'); return snapshotResponse(state); }, decode: async () => { decodes++; if (imageFail) throw new Error('bad image'); } });
  await env.client.load(); await tick(); fail = true; await env.client.load(); assert.equal(env.clears.length, 0); assert.deepEqual(env.shown, ['a.png']);
  fail = false; imageFail = true; state = slideshowSnapshot({ revision: 2, current: photo('b.png') }); await env.client.load(); await tick(); assert.equal(decodes, 2); assert.equal(env.clears.length, 0);
  await env.clock.advance(5000); assert.equal(decodes, 3); imageFail = false; await env.clock.advance(5000); assert.deepEqual(env.shown, ['a.png', 'b.png']);
  state = slideshowSnapshot({ revision: 3, count: 0, current: null }); await env.client.load(); assert.equal(env.clears.length, 1); env.client.dispose();
});

test('metadata deadline covers a stalled fetch and body, even when transport ignores abort', async () => {
  for (const bodyStalls of [false, true]) {
    const env = photoFollower({ fetchImpl: async () => bodyStalls ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {}) });
    const pending = env.client.load(); await tick(); await env.clock.advance(10_000); await pending; assert.match(env.reports.at(-1), /unavailable/); assert.equal(env.clock.timers.size, 1); env.client.dispose();
  }
});

test('response body byte cap accepts 8192 bytes and rejects 8193 bytes including multibyte input', async () => {
  for (const bytes of [8192, 8193]) {
    const raw = JSON.stringify(slideshowSnapshot({ current: photo('é".png') })); const body = raw + ' '.repeat(bytes - Buffer.byteLength(raw));
    const env = photoFollower({ fetchImpl: async () => new Response(body) }); await env.client.load(); await tick();
    assert.equal(env.shown.length, bytes === 8192 ? 1 : 0); env.client.dispose();
  }
});

test('decode timeout and disposal reject late image completion without leaked timers', async () => {
  const work = deferred(); const env = photoFollower({ decode: () => work.promise }); await env.client.load(); await tick(); await env.clock.advance(10_000);
  env.client.dispose(); work.resolve(); await tick(); assert.deepEqual(env.shown, []); assert.equal(env.clock.timers.size, 0);
});

test('a timed-out first decode retries within five seconds without polling or overlapping attempts', async () => {
  const pending = deferred(); let attempts = 0; let firstSignal;
  const env = photoFollower({ autoPoll: false, decode: (_url, { signal }) => { attempts++; if (attempts === 1) { firstSignal = signal; return pending.promise; } return Promise.resolve(); } });
  try {
    await env.client.load(); await tick(); await env.clock.advance(10_000);
    assert.equal(firstSignal.aborted, true); assert.equal(attempts, 1); assert.deepEqual(env.shown, []);
    await env.clock.advance(5000); assert.equal(attempts, 2); assert.deepEqual(env.shown, ['a.png']);
    pending.resolve(); await tick(); assert.deepEqual(env.shown, ['a.png']);
  } finally { env.client.dispose(); await tick(); }
  assert.equal(env.clock.timers.size, 0);
});

test('image recovery proceeds even when the next Global metadata request stalls', async () => {
  let reads = 0; let attempts = 0;
  const env = photoFollower({ fetchImpl: async () => { if (++reads === 1) return snapshotResponse(slideshowSnapshot()); return new Promise(() => {}); }, decode: async () => { if (++attempts === 1) throw new Error('Temporary image failure.'); } });
  try {
    await env.client.load(); await tick(); await env.clock.advance(5000);
    assert.equal(reads, 2); assert.equal(attempts, 2); assert.deepEqual(env.shown, ['a.png']);
  } finally { env.client.dispose(); await tick(); }
  assert.equal(env.clock.timers.size, 0);
});

test('metadata wakes use server-relative deadlines with 250ms and five-second bounds, never local image choice', async () => {
  const env = photoFollower();
  for (const [deadline, delay] of [[999_000, 250], [1_000_100, 250], [1_002_000, 2000], [2_000_000, 5000]]) {
    env.setState(slideshowSnapshot({ count: 2, nextChangeAt: deadline })); await env.client.load(); await tick();
    assert.equal([...env.clock.timers.values()][0].due - env.clock.now(), delay); assert.deepEqual(env.shown, ['a.png']);
  }
  env.client.dispose();
});

test('photo status describes a bounded pool and distinguishes confirmed empty from unavailable scans', async () => {
  const env = photoFollower(); await env.client.load(); await tick();
  assert.equal(env.reports.at(-1), 'Using 1 NFS background in this playback sequence.');
  env.setState(slideshowSnapshot({ count: 100, nextChangeAt: 1_005_000 })); await env.client.load();
  assert.equal(env.reports.at(-1), 'Using 100 NFS backgrounds in this playback sequence.'); assert.deepEqual(env.shown, ['a.png'], 'pool metadata does not decode 100 images');
  env.setState(slideshowSnapshot({ revision: 2, count: 0, current: null })); await env.client.load();
  assert.equal(env.reports.at(-1), 'No eligible photos were found in the completed inventory.'); assert.equal(env.clears.length, 1);
  env.setState(slideshowSnapshot({ revision: 2, count: 0, current: null, available: false })); await env.client.load();
  assert.match(env.reports.at(-1), /unavailable/); assert.equal(env.clears.length, 1);
  env.client.dispose();
});
