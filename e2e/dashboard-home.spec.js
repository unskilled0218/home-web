import { expect } from '@playwright/test';
import { globalTest as base } from './global-fixtures.js';
import { saveCategory, categoryTab } from './category-settings.js';
import { CATEGORY_IDS, SETTINGS_CATEGORIES } from '../public/dashboard-settings-categories.js';
import { normalizeForecast } from '../public/weather-data.js';
import { rawForecast } from '../test/fixtures/weather.js';
import { normalizeDashboardPreferences, validateDashboardPreferences } from '../public/dashboard-helpers.js';
import { mockSlideshow } from './photo-fixtures.js';

const settingsKey = 'dashboard.shared-settings.v1';
const instant = new Date('2026-10-11T12:00:00Z');
const photoUrl = '/api/dashboard/photos/abcdefghijklmnop';
const weatherMetadata = new WeakMap();

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (/invalid form control|not focusable/i.test(message.text())) errors.push(message.text()); });
    await page.route('**/api/calendar', (route) => route.fulfill({ json: { configured: false, encryptionReady: true } }));
    await mockSlideshow(page);
    await page.route('**/api/linkwarden', (route) => route.fulfill({ json: { linkwarden: { configured: false, configurationId: null, encryptionReady: true } } }));
    await mockWeather(page, { configured: false });
    await mockSharedSettings(page);
    const providerRequests = [];
    await page.route(/https:\/\/(?:api|air-quality-api)\.open-meteo\.com\//, (route) => { providerRequests.push(route.request().url()); return route.abort(); });
    await use(page);
    expect(providerRequests, 'browsers must not retrieve forecasts or air quality directly').toEqual([]);
    expect(errors, 'dashboard initializes and handles interactions without page errors').toEqual([]);
  }
});

async function seedPreferences(page, preferences) {
  await page.addInitScript((value) => { window.sharedSeedPreferences = value; }, preferences);
}

async function displayToggle(page, name, checked) {
  const category = CATEGORY_IDS.find(id => SETTINGS_CATEGORIES[id].keys.includes(name)); await categoryTab(page, category);
  await page.locator(`[name="${name}"]`).setChecked(checked);
}

async function mockSharedSettings(page) {
  let preferences; let revision = 1;
  const snapshot = () => { const weather = weatherMetadata.get(page)?.(); return { initialized: true, revision, preferences, integrations: { weather: weather ? { available: true, revision: weather.revision, location: weather.location } : { available: false }, calendar: { available: false }, linkwarden: { available: false } } }; };
  await page.route('**/api/dashboard/settings', async (route) => {
    preferences ??= normalizeDashboardPreferences(await page.evaluate(() => ({ ...(window.sharedSeedPreferences ?? {}), ...(window.bookmarkFixtureSelections && { bookmarkLinkSelections: window.bookmarkFixtureSelections }) })));
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (body.revision !== revision) return route.fulfill({ status: 409, json: { error: 'Shared preferences changed elsewhere.', snapshot: snapshot() } });
      preferences = validateDashboardPreferences(body.preferences); revision++;
    }
    return route.fulfill({ json: snapshot() });
  });
  return { setPreferences(next) { preferences = normalizeDashboardPreferences({ ...preferences, ...next }); revision++; } };
}

async function mockWeather(page, { configured = true } = {}) {
  const requests = { snapshot: 0, refresh: 0, save: 0 };
  let state = { configured, revision: configured ? 1 : 0, location: configured ? { label: 'London', latitude: 51, longitude: 0 } : null, timezone: 'UTC', forecastRegistered: configured, forecast: configured ? normalizeForecast(rawForecast()) : null, air: configured ? { aqi: 20 } : null, forecastUpdated: configured ? instant.getTime() : null, airUpdated: configured ? instant.getTime() : null, forecastError: false, airError: false, refreshing: false };
  weatherMetadata.set(page, () => state);
  await page.route('**/api/weather?*', (route) => {
    requests.snapshot++;
    return route.fulfill({ json: { ...state, timezone: new URL(route.request().url()).searchParams.get('timezone') } });
  });
  await page.route('**/api/weather/refresh', (route) => { requests.refresh++; return route.fulfill({ status: 202, json: { scheduled: state.refreshing, refreshing: state.refreshing } }); });
  await page.route('**/api/weather/location', (route) => {
    requests.save++; const body = route.request().postDataJSON();
    if (body.revision !== state.revision) return route.fulfill({ status: 409, json: { error: 'Weather location changed on another device. Reload and select the location again.' } });
    state = { ...state, configured: true, revision: state.revision + 1, location: body.location, forecastRegistered: true, forecast: normalizeForecast(rawForecast()), air: { aqi: 20 }, forecastUpdated: instant.getTime(), airUpdated: instant.getTime() };
    return route.fulfill({ json: state });
  });
  return { requests, getState: () => state, setState(next) { state = { ...state, ...next }; } };
}

async function mockCalendar(page, { longContent = false } = {}) {
  const requests = { status: 0, events: 0 };
  await page.route('**/api/calendar', (route) => { requests.status++; return route.fulfill({ json: { configured: true, encryptionReady: true, serverUrl: 'https://baikal.example.test', username: 'calendar' } }); });
  await page.route('**/api/calendar/events', (route) => {
    requests.events++;
    return route.fulfill({ json: { configured: true, stale: false, events: [{ title: longContent ? 'VeryLongUnbrokenCalendarTitle'.repeat(5) : 'Planning meeting', start: '2026-10-11T13:00:00Z', end: '2026-10-11T14:00:00Z', allDay: false, location: longContent ? 'A long meeting location with details that must wrap safely on a narrow screen' : 'Office' }] } });
  });
  return requests;
}

async function mockBookmarks(page, { long = false } = {}) {
  const ids = ['r'.repeat(43), 'c'.repeat(43), 'd'.repeat(43)];
  const selectionId = (id) => `b_${String(id).padStart(43, '0')}`;
  await page.addInitScript((value) => { window.bookmarkFixtureSelections = value; }, [1, 2, 3, 98].map((id) => ({ selectionId: selectionId(id), collectionSelectionId: ids[id === 98 ? 0 : id - 1] })));
  const names = long ? ['Long root collection name '.repeat(8), 'LongChildFolderName'.repeat(8), 'Grandchild'] : ['Root', 'Child', 'Grandchild'];
  const folders = ids.map((selectionId, i) => ({ selectionId, name: names[i], collectionToken: `token-${selectionId}`, children: [] }));
  folders[0].children = [folders[1]]; folders[1].children = [folders[2]];
  let collections = [folders[0]]; let version = 1;
  let status = { configured: true, configurationId: 'bookmark-configuration-one', encryptionReady: true, accessTokenPresent: true, baseUrl: 'https://linkwarden.test', username: 'sam' };
  const failures = new Map(); const requests = { status: 0, tree: 0, folders: [], mutations: [] };
  await page.route('**/api/linkwarden', (route) => {
    const request = route.request();
    if (request.method() === 'PUT') { const body = request.postDataJSON(); requests.mutations.push(body); status = { ...status, configured: true, configurationId: `bookmark-configuration-${++version}`, baseUrl: body.url, username: body.username }; return route.fulfill({ json: { linkwarden: status, configurationId: status.configurationId, collections } }); }
    if (request.method() === 'DELETE') { requests.mutations.push('DELETE'); status = { configured: false, configurationId: null, encryptionReady: true }; return route.fulfill({ status: 204 }); }
    requests.status++; return route.fulfill({ json: { linkwarden: status } });
  });
  await page.route('**/api/linkwarden/collections', (route) => { requests.tree++; return route.fulfill({ json: { configurationId: status.configurationId, collections } }); });
  await page.route('**/api/bookmarks?*', (route) => {
    const token = new URL(route.request().url()).searchParams.get('collection'); const index = folders.findIndex((folder) => folder.collectionToken === token);
    requests.folders.push(index); const failure = failures.get(index);
    if (failure) return route.fulfill({ status: failure.status, json: { error: failure.error, code: failure.code } });
    return route.fulfill({ json: { configured: true, configurationId: status.configurationId, collectionSelectionId: ids[index], stale: false, bookmarks: [{ id: index + 1, selectionId: selectionId(index + 1), name: ['Root bookmark', 'Child bookmark', 'Deep bookmark'][index], url: `https://example.test/${index}` }, ...(index === 0 ? [{ id: 99, selectionId: selectionId(99), name: 'Unsafe', url: 'javascript:alert(1)' }, { id: 98, selectionId: selectionId(98), name: '<img src=x onerror=alert(1)>', url: 'https://safe.test' }] : [])] } });
  });
  return { ids, requests, fail(index, failure) { failures.set(index, failure); }, setTree(next) { collections = next; }, renew() { for (const folder of folders) folder.collectionToken += '-renewed'; folders[0].name = 'Renamed root'; }, getStatus: () => status };
}

const sectionOrder = (page) => page.locator('#information > section').evaluateAll((sections) => sections.map((section) => section.id));
async function mobileGeometry(page) {
  const layout = await page.evaluate(() => {
    const tools = document.querySelector('.page-tools').getBoundingClientRect();
    const information = document.getElementById('information').getBoundingClientRect();
    const sections = [...document.querySelectorAll('#information > section:not([hidden])')].map((section) => ({ id: section.id, top: section.getBoundingClientRect().top, bottom: section.getBoundingClientRect().bottom, width: section.getBoundingClientRect().width }));
    return { hidden: document.getElementById('information').hidden, toolsBottom: tools.bottom, top: information.top, right: information.right, sections, width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  if (!layout.hidden) {
    expect(layout.top).toBeGreaterThanOrEqual(layout.toolsBottom);
    expect(layout.top - layout.toolsBottom, 'short mobile pages must not bottom-align information').toBeLessThanOrEqual(24);
  } else expect(layout.sections).toEqual([]);
  expect(layout.scrollWidth, 'mobile document must not overflow horizontally').toBe(layout.width);
  expect(layout.right).toBeLessThanOrEqual(layout.width);
  for (let i = 1; i < layout.sections.length; i++) expect(layout.sections[i].top, `${layout.sections[i].id} follows the previous section without overlap`).toBeGreaterThanOrEqual(layout.sections[i - 1].bottom);
}

async function savePreferences(page) {
  await saveCategory(page);
}

test('home initializes the photo dashboard without widget requests and handles unconfigured services', async ({ page }) => {
  const retiredRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/(?:app(?:-helpers)?\.js|styles\.css|home-(?:settings|widgets|information|integrations|shell|responsive)\.js|api\/home\/settings)$/.test(pathname)) retiredRequests.push(pathname);
  });
  await page.goto('/');
  await expect(page.locator('#time')).toHaveText(/\d/);
  await expect(page.locator('#weather')).toBeVisible();
  await expect(page.locator('#calendar-status')).toHaveText('Connect a Baikal calendar in Settings.');
  await expect(page.locator('#weather-status')).toHaveText('Choose a location in Settings to show weather.');
  await expect(page.locator('#fullscreen')).toBeVisible();
  await expect(page.locator('#home-grid, #home-catalog, #legacy-integration-controls')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await expect(page.locator('#photo-status')).toHaveText('No eligible photos were found in the completed inventory.');
  await page.locator('#close-settings').click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('#open-settings')).toBeFocused();
  expect(retiredRequests).toEqual([]);
});

test('existing preferences load at home and edits survive reload and legacy redirects', async ({ page }) => {
  await seedPreferences(page, { position: 'right', scale: 1.3, timezone: 'UTC', timeVisible: false, color: '#123456' });
  await page.goto('/');
  await expect(page.locator('#information')).toHaveClass('right');
  await expect(page.locator('#clock')).toBeHidden();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.locator('#open-settings').click();
  await expect(page.locator('[name="position"], [name="scale"]')).toHaveCount(0);
  await savePreferences(page);
  await displayToggle(page, 'timeVisible', true);
  await savePreferences(page);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey);
  expect(saved.position).toBe('right'); expect(saved.scale).toBe(1.3);
  expect(saved.timeVisible).toBe(true);
  expect(saved.color).toBe('#123456');
  await page.reload();
  await expect(page.locator('#clock')).toBeVisible();
  await expect(page.locator('#information')).toHaveClass('right');
  for (const route of ['/', '/dashboard', '/dashboard/', '/dashboard.html']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#information')).toHaveClass('right');
    await expect(page.locator('#clock')).toBeVisible();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toEqual(saved);
  }
});

for (const width of [1200, 320, 390]) test(`Settings remains usable at ${width}px without a widget canvas`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await page.locator('#open-settings').click();
  const dialog = page.locator('#settings-dialog');
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  for (const height of [800, 360]) {
    await page.setViewportSize({ width, height });
    for (const name of ['General', 'Time', 'Weather', 'Calendar', 'Bookmarks', 'Home Assistant', 'Wake-on-LAN', 'Images']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      const panel = page.getByRole('tabpanel', { name, exact: true });
      await expect(panel).toBeVisible();
      const tabBounds = await tab.boundingBox(); const panelBounds = await panel.boundingBox();
      expect(tabBounds.x + tabBounds.width).toBeLessThanOrEqual(panelBounds.x);
      expect(await page.locator('.settings-panels').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.locator('#save-preferences')).toBeInViewport();
      await expect(page.locator('#close-settings')).toBeInViewport();
    }
  }
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Timezone', { exact: true }).fill('UTC');
  await page.locator('[name="seconds"]').uncheck();
  await savePreferences(page);
  await page.locator('#close-settings').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#home-grid, .widget-move, .widget-resize')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
});

test('home renders a decoded background, weather forecasts, and calendar events from service responses', async ({ page }) => {
  await page.clock.setFixedTime(instant);
  await seedPreferences(page, { timezone: 'UTC', imageInfo: true, animation: 'none', location: { latitude: 51, longitude: 0, label: 'London' } });
  await mockSlideshow(page, [{ name: 'sample.png', lastModified: instant.getTime(), url: photoUrl }]);
  await page.route(`**${photoUrl}`, (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await mockWeather(page);
  await page.route('**/api/calendar', (route) => route.fulfill({ json: { configured: true, encryptionReady: true, serverUrl: 'https://baikal.example.test', username: 'calendar' } }));
  await page.route('**/api/calendar/events', (route) => route.fulfill({ json: { configured: true, stale: false, events: [{ title: 'Planning meeting', start: '2026-10-11T13:00:00Z', end: '2026-10-11T14:00:00Z', allDay: false, location: 'Office' }] } }));
  await page.goto('/');
  await expect(page.locator('#photos .photo-layer img')).toBeVisible();
  await expect.poll(() => page.locator('#photos .photo-layer img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('#photo-caption')).toHaveText('sample.png');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 20');
  await expect(page.locator('#hourly .forecast-item')).toHaveCount(7);
  await expect(page.locator('#daily .forecast-item')).toHaveCount(7);
  await expect(page.locator('#calendar-events')).toContainText('Planning meeting');
  await expect(page.locator('#calendar-events')).toContainText('Office');
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('#calendar-url')).toHaveValue('https://baikal.example.test');
  await expect(page.locator('#calendar-password')).toHaveValue('');
});

for (const width of [320, 390]) for (const scale of [0.5, 1, 2]) test(`mobile views at ${width}px remain readable at scale ${scale}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 }); await page.clock.setFixedTime(instant);
  await seedPreferences(page, { timezone: 'UTC', dateStyle: 'full', seconds: true, position: 'right', scale: 2, timeVisible: false, weatherVisible: false, calendarVisible: false, mobileTimeScale: scale, mobileWeatherScale: scale, mobileCalendarScale: scale });
  const weather = await mockWeather(page); await mockCalendar(page, { longContent: true });
  const forecast = normalizeForecast(rawForecast(-21.5));
  forecast.daily = forecast.daily.map((day) => ({ ...day, min: -125.5, max: 126.5 }));
  weather.setState({ forecast });
  await page.goto('/');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('-21.5 °C');
  await expect(page.locator('#calendar-events')).toContainText('VeryLongUnbrokenCalendarTitle');
  await expect(page.locator('#weather-updated')).toBeVisible();
  await expect(page.locator('#hourly .forecast-item')).toHaveCount(7);
  await expect(page.locator('#daily .forecast-item')).toHaveCount(7);
  expect(await sectionOrder(page)).toEqual(['clock', 'weather', 'calendar']);
  await expect(page.locator('#information')).not.toHaveClass('right');
  for (const id of ['clock', 'weather', 'calendar']) await expect(page.locator(`#${id}`)).toHaveCSS('font-size', `${16 * scale}px`);
  const clockSize = await page.locator('#time').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(clockSize).toBeCloseTo(Math.max(24, Math.min(width * 0.08, 48)) * scale, 1);
  await mobileGeometry(page);
  for (const selector of ['#time', '.temperature', '.forecast-temperature', '.calendar-event-title', '#weather-updated']) {
    expect(await page.locator(selector).evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)), `${selector} must display its content without horizontal clipping`).toBe(true);
  }
});

test('legacy mobile defaults start at the top even with unconfigured or hidden content', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const legacy = { timeVisible: false, weatherVisible: false, calendarVisible: false, position: 'right', scale: 2 };
  await seedPreferences(page, legacy); await page.goto('/');
  await expect(page.locator('#weather-status')).toHaveText('Choose a location in Settings to show weather.');
  for (const id of ['clock', 'weather', 'calendar']) await expect(page.locator(`#${id}`)).toBeVisible();
  await mobileGeometry(page);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toMatchObject(legacy);
  await page.locator('#open-settings').click();
  for (const name of ['mobileTimeVisible', 'mobileWeatherVisible', 'mobileCalendarVisible']) {
    await displayToggle(page, name, false); await savePreferences(page);
  }
  await savePreferences(page); await page.locator('#close-settings').click();
  for (const id of ['clock', 'weather', 'calendar']) await expect(page.locator(`#${id}`)).toBeHidden();
  await mobileGeometry(page);
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await categoryTab(page, 'weather');
  await expect(page.locator('[name="mobileWeatherVisible"]')).toBeVisible();
});

test('each mobile toggle hides only its view and preserves ordering without empty gaps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 }); await page.clock.setFixedTime(instant);
  await mockWeather(page); await mockCalendar(page); await page.goto('/');
  await expect(page.locator('#calendar-events')).toContainText('Planning meeting');
  await page.locator('#open-settings').click();
  for (const [name, id] of [['mobileTimeVisible', 'clock'], ['mobileWeatherVisible', 'weather'], ['mobileCalendarVisible', 'calendar']]) {
    await displayToggle(page, name, false); await savePreferences(page);
    await page.locator('#close-settings').click();
    await expect(page.locator(`#${id}`)).toBeHidden();
    for (const other of ['clock', 'weather', 'calendar'].filter((view) => view !== id)) await expect(page.locator(`#${other}`)).toBeVisible();
    expect(await sectionOrder(page)).toEqual(['clock', 'weather', 'calendar']); await mobileGeometry(page);
    const firstGap = await page.locator('#information > section:not([hidden])').first().evaluate((node) => node.getBoundingClientRect().top - document.getElementById('information').getBoundingClientRect().top);
    expect(firstGap).toBeLessThanOrEqual(1);
    await page.locator('#open-settings').click();
    await displayToggle(page, name, true); await savePreferences(page);
  }
});

test('mobile preferences save across tabs and reload without changing desktop values', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const desktop = { position: 'right', scale: 1.4, timeVisible: false, timeScale: 0.7, weatherVisible: true, weatherScale: 1.6, calendarVisible: false, calendarScale: 0.8 };
  await seedPreferences(page, desktop); await page.goto('/'); await page.locator('#open-settings').click();
  await displayToggle(page, 'mobileTimeVisible', false); await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Clock scale on mobile', { exact: true }).fill('1.2');
  await savePreferences(page);
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await page.getByLabel('Weather scale on mobile', { exact: true }).fill('0.8');
  await savePreferences(page);
  await displayToggle(page, 'mobileCalendarVisible', false); await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Calendar scale on mobile', { exact: true }).fill('1.7');
  await savePreferences(page);
  await page.getByRole('tab', { name: 'Time', exact: true }).click(); await expect(page.getByLabel('Clock scale on mobile', { exact: true })).toHaveValue('1.2');
  await savePreferences(page);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey);
  expect(saved).toMatchObject({ ...desktop, mobileTimeVisible: false, mobileTimeScale: 1.2, mobileWeatherVisible: true, mobileWeatherScale: 0.8, mobileCalendarVisible: false, mobileCalendarScale: 1.7 });
  await page.reload(); await expect(page.locator('#clock')).toBeHidden(); await expect(page.locator('#calendar')).toBeHidden(); await expect(page.locator('#weather')).toHaveCSS('font-size', '12.8px');
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('#information')).toHaveClass('right'); expect(await sectionOrder(page)).toEqual(['calendar', 'clock', 'weather']);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toEqual(saved);
  await page.setViewportSize({ width: 320, height: 800 }); await page.locator('#open-settings').click();
  await displayToggle(page, 'timeVisible', true); await page.getByRole('tab', { name: 'Time', exact: true }).click(); await page.getByLabel('Clock scale', { exact: true }).fill('1.5');
  await savePreferences(page); await page.locator('#close-settings').click();
  await expect(page.locator('#clock')).toBeHidden();
  await page.setViewportSize({ width: 900, height: 800 }); await expect(page.locator('#clock')).toBeVisible();
  const edited = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey);
  expect(edited).toMatchObject({ timeVisible: true, timeScale: 1.5, mobileTimeVisible: false, mobileTimeScale: 1.2 });
});

test('fractional stored mobile scales remain valid when saving an unrelated preference', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await seedPreferences(page, { mobileTimeScale: 1.25, mobileWeatherScale: 0.55, mobileCalendarScale: 1.11 });
  await page.goto('/'); await page.locator('#open-settings').click();
  const valid = await page.locator('[name^="mobile"][type="number"]').evaluateAll((inputs) => inputs.map((input) => ({ value: input.valueAsNumber, valid: input.validity.valid, form: input.form.id })));
  expect(valid).toEqual([{ value: 1.3, valid: true, form: 'preferences' }, { value: 0.6, valid: true, form: 'preferences' }, { value: 1.1, valid: true, form: 'preferences' }, ...Array.from({ length: 3 }, () => ({ value: 1, valid: true, form: 'preferences' }))]);
  await categoryTab(page, 'images'); await page.getByLabel('Opacity', { exact: true }).fill('0.5'); await savePreferences(page);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toMatchObject({ opacity: 0.5, mobileTimeScale: 1.3, mobileWeatherScale: 0.6, mobileCalendarScale: 1.1 });
});

test('invalid mobile scales block only their category while another category can save', async ({ page }) => {
  await page.goto('/'); await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Time', exact: true }).click(); await page.getByLabel('Clock scale on mobile', { exact: true }).fill('3');
  await page.getByRole('tab', { name: 'Weather', exact: true }).click(); await page.getByLabel('Weather scale on mobile', { exact: true }).fill('1.4');
  await savePreferences(page); await categoryTab(page, 'time'); await page.locator('#save-preferences').click();
  await expect(page.getByRole('tab', { name: 'Time', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Clock scale on mobile', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('dashboard.preferences.v1'))).toBeNull();
  await page.locator('#reload-shared-preferences').click(); await expect(page.locator('#settings-status')).toContainText('Time settings reloaded.'); await page.getByLabel('Clock scale on mobile', { exact: true }).fill('1.3'); await savePreferences(page);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toMatchObject({ mobileTimeScale: 1.3, mobileWeatherScale: 1.4 });
});

test('changing one mobile scale leaves the other view sizes and desktop scales intact', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await seedPreferences(page, { scale: 2, timeScale: 2, weatherScale: 1.8, calendarScale: 0.5 });
  await page.goto('/'); await page.locator('#open-settings').click();
  const sizes = { clock: 16, weather: 16, calendar: 16 };
  for (const [tab, label, id, scale] of [['Weather', 'Weather scale on mobile', 'weather', 1.4], ['Time', 'Clock scale on mobile', 'clock', 0.5], ['Calendar', 'Calendar scale on mobile', 'calendar', 2]]) {
    await page.getByRole('tab', { name: tab, exact: true }).click(); await page.getByLabel(label, { exact: true }).fill(String(scale)); await savePreferences(page);
    sizes[id] = 16 * scale;
    for (const [view, expected] of Object.entries(sizes)) expect(await page.locator(`#${view}`).evaluate((node) => parseFloat(getComputedStyle(node).fontSize)), `${view} responds only to its own mobile scale`).toBeCloseTo(expected, 2);
  }
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toMatchObject({ scale: 2, timeScale: 2, weatherScale: 1.8, calendarScale: 0.5 });
});

test('shared format and units apply in both layouts outside the profile display groups', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 }); await page.clock.setFixedTime(instant); await mockWeather(page);
  await page.goto('/'); await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  const time = page.getByRole('tabpanel', { name: 'Time', exact: true });
  await expect(time.getByRole('group', { name: 'Desktop display', exact: true }).locator('[name="timezone"]')).toHaveCount(0);
  await expect(time.getByRole('group', { name: 'Shared format', exact: true }).getByLabel('Timezone', { exact: true })).toHaveCount(1);
  await page.getByLabel('Timezone', { exact: true }).fill('Asia/Tokyo'); await page.getByLabel('12-hour clock', { exact: true }).uncheck(); await page.getByLabel('Show seconds', { exact: true }).uncheck();
  await savePreferences(page);
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  const weather = page.getByRole('tabpanel', { name: 'Weather', exact: true });
  await expect(weather.getByRole('group', { name: 'Desktop display', exact: true }).locator('[name="temperature"]')).toHaveCount(0);
  await expect(weather.getByRole('group', { name: 'Shared units', exact: true }).getByRole('combobox', { name: 'Temperature', exact: true })).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Temperature', exact: true }).selectOption('fahrenheit');
  await page.getByRole('combobox', { name: 'Wind', exact: true }).selectOption('kn'); await page.getByRole('combobox', { name: 'Precipitation', exact: true }).selectOption('inch');
  await savePreferences(page); await page.locator('#close-settings').click();
  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('#time')).toHaveText('21:00'); await expect(page.locator('#weather-updated')).toContainText('21:00');
    await expect(page.locator('#current-weather-values .temperature')).toHaveText('53.6 °F');
    await expect(page.locator('#current-weather-subvalues')).toContainText('Wind 4.3 kn'); await expect(page.locator('#current-weather-subvalues')).toContainText('Precipitation 1 inch');
  }
});

test('breakpoint and orientation changes switch profiles without saving or losing Settings drafts', async ({ page }) => {
  const saved = { position: 'right', scale: 1.4, timeVisible: false, timeScale: 0.8, weatherVisible: true, weatherScale: 1.5, calendarVisible: true, calendarScale: 1.2, mobileTimeVisible: true, mobileTimeScale: 0.6, mobileWeatherVisible: false, mobileWeatherScale: 1.7, mobileCalendarVisible: true, mobileCalendarScale: 0.9 };
  await page.setViewportSize({ width: 600, height: 900 }); await seedPreferences(page, saved); await page.goto('/');
  await page.evaluate(() => { window.originalSections = [...document.querySelectorAll('#information > section')]; });
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Time', exact: true }).click(); await page.getByLabel('Clock scale on mobile', { exact: true }).fill('1.7');
  for (const [width, height] of [[601, 800], [600, 900], [720, 390], [390, 720], [601, 800], [600, 900]]) {
    await page.setViewportSize({ width, height }); const mobile = width <= 600;
    await expect.poll(() => sectionOrder(page)).toEqual(mobile ? ['clock', 'weather', 'calendar'] : ['calendar', 'clock', 'weather']);
    for (const [id, visible] of [['clock', mobile], ['weather', !mobile], ['calendar', true]]) await expect(page.locator(`#${id}`)).toHaveJSProperty('hidden', !visible);
    expect(await page.locator('#information').evaluate((node) => node.classList.contains('right'))).toBe(!mobile);
    expect(await page.locator('#clock').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(mobile ? 9.6 : 17.92, 2);
    await expect(page.getByRole('tab', { name: 'Time', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(page.getByLabel('Clock scale on mobile', { exact: true })).toHaveValue('1.7');
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toMatchObject(saved);
    expect(await page.evaluate(() => window.originalSections.every((node) => document.getElementById(node.id) === node))).toBe(true);
    await expect(page.locator('#information > section')).toHaveCount(3);
  }
  await page.locator('#close-settings').click(); await mobileGeometry(page);
  await page.setViewportSize({ width: 900, height: 1000 });
  const desktop = await page.locator('#information').boundingBox();
  const devices = await page.locator('#dashboard-devices').boundingBox();
  expect(devices.y, 'intermediate layout stacks device sections after information').toBeGreaterThanOrEqual(desktop.y + desktop.height);
  expect(await page.locator('#information').evaluate((node) => [node.firstElementChild.tagName, node.lastElementChild.id])).toEqual(['H1', 'photo-caption']);
});

for (const mobileOnly of [true, false]) test(`resizing keeps one refresh owner with calendar visible only on ${mobileOnly ? 'mobile' : 'desktop'}`, async ({ page }) => {
  await page.clock.install({ time: instant });
  await page.addInitScript(() => {
    const intervals = new Set(); const create = window.setInterval.bind(window); const remove = window.clearInterval.bind(window);
    window.setInterval = (...args) => { const id = create(...args); if (args[1] === 1000) intervals.add(id); return id; };
    window.clearInterval = (id) => { intervals.delete(id); remove(id); };
    window.activeClockIntervals = () => intervals.size;
  });
  await seedPreferences(page, { timezone: 'UTC', calendarVisible: !mobileOnly, mobileCalendarVisible: mobileOnly, interval: 3600, animation: 'fade' });
  const weather = await mockWeather(page); const calendar = await mockCalendar(page);
  let manifests = 0; let images = 0;
  await mockSlideshow(page, [{ name: 'first.png', lastModified: 1, url: photoUrl }, { name: 'second.png', lastModified: 2, url: '/api/dashboard/photos/qrstuvwxyzABCDEF' }], () => { manifests++; });
  await page.route('**/api/dashboard/photos/*', (route) => { images++; return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }); });
  await page.goto('/');
  await expect.poll(() => weather.requests.refresh).toBe(1); await expect.poll(() => calendar.events).toBe(1);
  await expect(page.locator('#photos .photo-layer img')).toBeVisible();
  await page.evaluate(() => { window.initialPhotoLayer = document.querySelector('.photo-layer'); });
  const before = { weather: { ...weather.requests }, calendar: { ...calendar }, manifests, images };
  for (const width of [600, 601, 390, 720, 600, 601]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('#calendar')).toHaveJSProperty('hidden', (width <= 600) !== mobileOnly);
    expect(await page.evaluate(() => window.activeClockIntervals())).toBe(1);
    expect(await page.evaluate(() => window.initialPhotoLayer === document.querySelector('.photo-layer'))).toBe(true);
  }
  expect({ weather: weather.requests, calendar, manifests, images }).toEqual(before);
  for (let i = 1; i <= 5; i++) {
    await page.clock.fastForward(60000);
    await expect.poll(() => weather.requests.refresh).toBe(before.weather.refresh + i);
  }
  await expect.poll(() => calendar.events).toBe(before.calendar.events + 1);
  expect(calendar.status).toBe(before.calendar.status); expect(weather.requests.snapshot).toBe(before.weather.snapshot + 5);
  expect(manifests).toBeGreaterThan(before.manifests); expect(images).toBe(before.images); expect(await page.evaluate(() => window.activeClockIntervals())).toBe(1);
});

test('hiding calendar in both profiles pauses events while retaining connection controls', async ({ page }) => {
  await page.clock.install({ time: instant }); await seedPreferences(page, { calendarVisible: false, mobileCalendarVisible: true });
  const calendar = await mockCalendar(page); await page.goto('/'); await expect.poll(() => calendar.events).toBe(1);
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await displayToggle(page, 'mobileCalendarVisible', false); await savePreferences(page);
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect calendar', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Baikal server URL', { exact: true })).toHaveValue('https://baikal.example.test');
  await page.locator('#close-settings').click();
  for (const width of [390, 900]) { await page.setViewportSize({ width, height: 800 }); await expect(page.locator('#calendar')).toBeHidden(); }
  await page.clock.fastForward(300000);
  expect(calendar.events).toBe(1); expect(calendar.status).toBe(1);
});

for (const position of ['left', 'right']) test(`flat selected bookmarks stay to the right without overlapping ${position} information`, async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 }); await seedPreferences(page, { position }); const mock = await mockBookmarks(page);
  await page.goto('/'); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Root bookmark', exact: true })).toBeVisible();
  await expect(page.locator('#bookmark-tree details, #bookmark-tree summary')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Unsafe', exact: true })).toHaveCount(0); await expect(page.locator('#bookmark-tree img')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '<img src=x onerror=alert(1)>', exact: true })).toHaveAttribute('href', 'https://safe.test/');
  for (const width of [1200, 601]) {
    await page.setViewportSize({ width, height: 900 });
    const information = await page.locator('#information').boundingBox(); const bookmarks = await page.locator('#bookmarks').boundingBox(); const tools = await page.locator('.page-tools').boundingBox();
    if (width > 1000) expect(information.x + information.width).toBeLessThanOrEqual(bookmarks.x);
    else expect(bookmarks.y).toBeGreaterThanOrEqual(information.y + information.height);
    expect(bookmarks.y).toBeGreaterThanOrEqual(tools.y + tools.height); expect(bookmarks.x + bookmarks.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  expect(mock.requests.tree).toBe(1); expect(mock.requests.folders.sort()).toEqual([0, 1, 2]);
});

for (const width of [320, 390]) test(`Settings nests links under folders while the mobile dashboard stays flat at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 }); const mock = await mockBookmarks(page, { long: true }); await page.goto('/');
  await expect(page.getByRole('link', { name: 'Root bookmark', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible(); await expect(page.locator('#bookmark-tree details')).toHaveCount(0);
  const info = await page.locator('#information').boundingBox(); const bookmarkBounds = await page.locator('#bookmarks').boundingBox(); expect(bookmarkBounds.y).toBeGreaterThanOrEqual(info.y + info.height);
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  const root = page.locator(`details[data-selection-id="${mock.ids[0]}"]`); const child = page.locator(`details[data-selection-id="${mock.ids[1]}"]`); const deep = page.locator(`details[data-selection-id="${mock.ids[2]}"]`);
  await expect(root).toHaveJSProperty('open', true); await expect(child).toHaveJSProperty('open', false); await expect(deep).toHaveJSProperty('open', false); expect(mock.requests.folders.sort()).toEqual([0, 1, 2]);
  await child.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
  await expect(child.locator(':scope > .bookmark-picker-links')).toContainText('Child bookmark'); await expect(deep).toHaveJSProperty('open', false); expect(mock.requests.folders.sort()).toEqual([0, 1, 2]);
  await deep.locator(':scope > summary').focus(); await page.keyboard.press('Space'); await expect(deep.locator(':scope > .bookmark-picker-links')).toContainText('Deep bookmark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await child.locator(':scope > summary').click(); await expect(child).toHaveJSProperty('open', false);
  await child.locator(':scope > summary').click(); await expect(deep).toHaveJSProperty('open', true); expect(mock.requests.folders).toEqual([0, 1, 2]); await page.locator('#close-settings').click(); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible();
});

test('legacy mobile bookmark preferences round-trip while selected links stay flat and fresh', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 }); await seedPreferences(page, { mobileBookmarksMode: 'expanded' }); const mock = await mockBookmarks(page); await page.goto('/');
  await expect(page.getByRole('link', { name: 'Root bookmark', exact: true })).toBeVisible(); await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Mobile bookmark display', exact: true })).toHaveCount(0); await savePreferences(page); await page.locator('#close-settings').click();
  await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible();
  const reads = mock.requests.folders.length;
  for (const width of [601, 390, 900, 320]) { await page.setViewportSize({ width, height: 800 }); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible(); }
  expect(mock.requests.folders.length).toBe(reads);
  await page.reload(); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences.mobileBookmarksMode, settingsKey)).toBe('expanded');
});

test('a failed bookmark folder preserves its siblings and retry does not reload the whole tree', async ({ page }) => {
  const mock = await mockBookmarks(page); mock.fail(1, { status: 503, error: 'Child unavailable.' }); await page.goto('/');
  await expect(page.getByRole('link', { name: 'Root bookmark', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible();
  await expect(page.locator('#bookmarks-status')).toContainText('unavailable'); const trees = mock.requests.tree;
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click(); await page.locator(`details[data-selection-id="${mock.ids[1]}"] > summary`).click(); await expect(page.locator('#bookmark-picker-folders')).toContainText('Child unavailable.');
  mock.fail(1, null); await page.getByRole('button', { name: 'Reload folder', exact: true }).click(); await expect(page.locator('#bookmark-picker-folders')).toContainText('Child bookmark'); await page.locator('#close-settings').click(); await expect(page.getByRole('link', { name: 'Child bookmark', exact: true })).toBeVisible();
  expect(mock.requests.tree).toBe(trees); expect(mock.requests.folders.filter((id) => id === 0)).toHaveLength(2);
});

test('Linkwarden connection controls stay independent from display drafts and never save the access token', async ({ page }) => {
  const mock = await mockBookmarks(page); await page.goto('/'); await expect(page.getByRole('link', { name: 'Root bookmark', exact: true })).toBeVisible();
  await page.locator('#open-settings').click(); await categoryTab(page, 'time'); await page.getByLabel('Clock scale', { exact: true }).fill('0.1'); await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  await expect(page.getByLabel('Linkwarden access token', { exact: true })).toHaveValue(''); await expect(page.getByLabel('Linkwarden URL', { exact: true })).toHaveValue('https://linkwarden.test');
  await page.getByLabel('Linkwarden access token', { exact: true }).fill('private-test-token'); await page.getByRole('button', { name: 'Connect Linkwarden', exact: true }).click();
  await expect(page.locator('#linkwarden-settings-status')).toHaveText('Linkwarden connected.'); await expect(page.getByLabel('Linkwarden access token', { exact: true })).toHaveValue('');
  expect(mock.requests.mutations[0]).toEqual({ url: 'https://linkwarden.test', username: 'sam', accessToken: 'private-test-token' }); expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).not.toContain('private-test-token');
  await page.getByRole('button', { name: 'Connect Linkwarden', exact: true }).click(); await expect.poll(() => mock.requests.mutations.length).toBe(2); expect(mock.requests.mutations[1].accessToken).toBe('');
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Disconnect Linkwarden', exact: true }).click(); await expect(page.locator('#linkwarden-settings-status')).toHaveText('Linkwarden disconnected.');
  await expect(page.locator('#bookmark-tree a')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Disconnect Linkwarden', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Time', exact: true }).click(); await expect(page.getByLabel('Clock scale', { exact: true })).toHaveValue('0.1');
});

for (const width of [390, 1200]) test(`fullscreen bookmark hiding releases space and restores disclosure state at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 }); const mock = await mockBookmarks(page); await page.goto('/'); await expect(page.getByRole('link', { name: 'Root bookmark', exact: true })).toBeVisible();
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  const child = page.locator(`details[data-selection-id="${mock.ids[1]}"]`); await child.locator(':scope > summary').click();
  const openBefore = await child.evaluate((node) => node.open);
  await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  await page.getByLabel('Hide bookmarks in fullscreen', { exact: true }).check(); await savePreferences(page); await page.locator('#close-settings').click();
  const requests = mock.requests.folders.length; await page.locator('#fullscreen').click(); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true); await expect(page.locator('#bookmarks')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/bookmarks-shown/);
  expect(await page.locator('#dashboard-content').evaluate((node) => getComputedStyle(node).display)).toBe(width > 1000 ? 'grid' : 'block');
  await expect(page.locator('#dashboard-ha')).toBeVisible(); await expect(page.locator('#dashboard-wol')).toBeVisible();
  // Headless Chromium's synthetic Escape does not invoke its browser-level fullscreen exit.
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await expect(page.locator('#bookmarks')).toBeVisible(); await expect(child).toHaveJSProperty('open', openBefore); expect(mock.requests.folders.length).toBe(requests);
  await page.locator('#open-settings').click(); await categoryTab(page, 'bookmarks'); await page.getByLabel('Hide bookmarks in fullscreen', { exact: true }).uncheck(); await savePreferences(page); await page.locator('#close-settings').click();
  await page.locator('#fullscreen').click(); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true); await expect(page.locator('#bookmarks')).toBeVisible(); await page.evaluate(() => document.exitFullscreen());
});

test('bookmark-only preference saves and fullscreen keep the photo and unrelated request owners intact', async ({ page }) => {
  const mock = await mockBookmarks(page); await mockWeather(page); await mockCalendar(page);
  const calls = [];
  page.on('request', (request) => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/weather') || path.startsWith('/api/calendar') || path.startsWith('/api/dashboard/photos')) calls.push(path); });
  await mockSlideshow(page, [{ name: 'photo.png', lastModified: 1, url: photoUrl }]);
  await page.route(`**${photoUrl}`, (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/'); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible(); await expect(page.locator('#photos .photo-layer img')).toBeVisible();
  await page.locator('#open-settings').click();
  await page.evaluate(() => { window.savedPhoto = document.querySelector('.photo-layer'); }); const before = calls.length;
  await categoryTab(page, 'bookmarks');
  await page.getByLabel('Hide bookmarks in fullscreen', { exact: true }).check(); await savePreferences(page); await page.locator('#close-settings').click();
  await page.locator('#fullscreen').click(); await expect(page.locator('#bookmarks')).toBeHidden(); await page.evaluate(() => document.exitFullscreen()); await expect(page.locator('#bookmarks')).toBeVisible();
  const selections = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences.bookmarkLinkSelections, settingsKey);
  await page.locator('#open-settings').click(); await displayToggle(page, 'bookmarksVisible', false); await savePreferences(page); await page.locator('#close-settings').click(); await expect(page.locator('#bookmarks')).toBeHidden();
  await page.locator('#fullscreen').click(); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true); await page.evaluate(() => document.exitFullscreen()); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false); await expect(page.locator('#bookmarks')).toBeHidden();
  await page.locator('#open-settings').click(); await displayToggle(page, 'bookmarksVisible', true); await savePreferences(page); await page.locator('#close-settings').click();
  await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toHaveAttribute('target', '_blank');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences.bookmarkLinkSelections, settingsKey)).toEqual(selections);
  expect(calls.length).toBe(before); expect(await page.evaluate(() => window.savedPhoto === document.querySelector('.photo-layer'))).toBe(true); expect(mock.requests.tree).toBe(1);
});

test('renewed bookmark tokens retain folder and link focus while updating labels', async ({ page }) => {
  await page.clock.install({ time: instant }); const mock = await mockBookmarks(page); await page.goto('/'); await expect(page.getByRole('link', { name: 'Deep bookmark', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Root bookmark', exact: true }).focus(); await page.getByRole('link', { name: 'Root bookmark', exact: true }).evaluate((node) => { window.initialBookmarkLink = node; });
  mock.renew(); await page.clock.fastForward(300000);
  await expect(page.locator('#bookmark-picker-folders')).toContainText('Renamed root'); await expect(page.locator('#bookmark-tree')).not.toContainText('Renamed root'); await expect(page.getByRole('link', { name: 'Root bookmark', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.initialBookmarkLink.isConnected)).toBe(true); expect(mock.requests.tree).toBe(2);
});

test('empty bookmark trees and empty folder data have distinct accessible statuses', async ({ page }) => {
  const mock = await mockBookmarks(page); mock.setTree([]); await page.goto('/'); await expect(page.locator('#bookmarks-status')).toContainText('selected links unavailable');
  mock.setTree([{ selectionId: mock.ids[0], name: 'Empty folder', collectionToken: `token-${mock.ids[0]}`, children: [] }]);
  await page.route('**/api/bookmarks?*', (route) => route.fulfill({ json: { configurationId: mock.getStatus().configurationId, collectionSelectionId: mock.ids[0], bookmarks: [], stale: false } }));
  await page.reload(); await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click(); await expect(page.locator('#bookmark-picker-folders')).toContainText('No bookmarks in this folder.'); await expect(page.locator('#bookmark-tree a')).toHaveCount(0);
});

test('deep bookmark indentation and large desktop scales fit the narrow sidebar layout', async ({ page }) => {
  await page.setViewportSize({ width: 601, height: 700 }); await page.clock.setFixedTime(instant); await seedPreferences(page, { position: 'right', scale: 2, timeScale: 2, weatherScale: 2, calendarScale: 2 });
  const mock = await mockBookmarks(page); await mockWeather(page); await mockCalendar(page, { longContent: true });
  let folder = { selectionId: 'collection-deep-test-15'.padEnd(43, 'x'), name: 'Deep label'.repeat(12), collectionToken: 'token-deep-test-15', children: [] };
  for (let i = 14; i >= 0; i--) folder = { selectionId: `collection-deep-test-${String(i).padStart(2, '0')}`.padEnd(43, 'x'), name: 'Deep label'.repeat(12), collectionToken: `token-deep-test-${String(i).padStart(2, '0')}`, children: [folder] };
  await page.addInitScript(() => { window.bookmarkFixtureSelections = [{ selectionId: 'b_' + '8'.repeat(43), collectionSelectionId: 'collection-deep-test-15'.padEnd(43, 'x') }]; });
  mock.setTree([folder]); await page.route('**/api/bookmarks?*', (route) => route.fulfill({ json: { configurationId: mock.getStatus().configurationId, collectionSelectionId: 'collection-deep-test-15'.padEnd(43, 'x'), bookmarks: [{ id: 8, selectionId: 'b_' + '8'.repeat(43), name: 'Deep selected link', url: 'https://example.test/deep' }], stale: false } }));
  await page.goto('/'); await expect(page.locator('#bookmark-tree details')).toHaveCount(0); await expect(page.getByRole('link', { name: 'Deep selected link', exact: true })).toBeVisible(); await expect(page.locator('#bookmark-picker-folders details')).toHaveCount(16); await expect(page.locator('#calendar-events')).toContainText('VeryLongUnbrokenCalendarTitle');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(601);
  expect(await page.locator('#bookmarks').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('fullscreen enters and exits when the browser supports it', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('#fullscreen');
  if (!await page.evaluate(() => document.fullscreenEnabled)) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveText('Fullscreen unavailable');
    return;
  }
  await button.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(button).toHaveText('Exit fullscreen');
  await expect(page.locator('#edit-layout')).toBeHidden();
  await expect(page.locator('#open-settings')).toBeHidden();
  await expect(button).toBeHidden();
  await page.evaluate(() => document.exitFullscreen());
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Enter fullscreen');
});

test('tabs support pointer and vertical keyboard navigation with one selected panel', async ({ page }) => {
  await page.goto('/');
  await page.locator('#open-settings').click();
  const general = page.getByRole('tab', { name: 'General', exact: true });
  await expect(general).toBeFocused();
  const before = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  for (const [key, name] of [['ArrowUp', 'Images'], ['ArrowDown', 'General'], ['ArrowDown', 'Time'], ['End', 'Images'], ['Home', 'General']]) {
    await page.keyboard.press(key);
    const tab = page.getByRole('tab', { name, exact: true });
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toHaveAttribute('tabindex', '0');
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'General', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#settings-scope-general')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(general).toBeFocused();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Weather', exact: true })).toBeVisible();
  await expect(page.locator('[name="timezone"]')).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('#open-settings')).toBeFocused();
  await page.locator('#open-settings').click();
  await expect(general).toBeFocused();
  await expect(general).toHaveAttribute('aria-selected', 'true');
});

test('tab switches retain drafts and category saves exclude hidden panels and service forms', async ({ page }) => {
  const serviceMutations = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/calendar')) serviceMutations.push(request.method());
    if (request.url().includes('geocoding-api.open-meteo.com')) serviceMutations.push('search');
  });
  await page.goto('/');
  await page.locator('#open-settings').click();
  const original = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  await categoryTab(page, 'weather');
  await page.getByLabel('Weather scale', { exact: true }).fill('1.2');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Show seconds', { exact: true }).uncheck();
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await page.getByLabel('Interval (seconds)', { exact: true }).fill('90');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await expect(page.getByLabel('Show seconds', { exact: true })).not.toBeChecked();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.getByLabel('Weather scale', { exact: true })).toHaveValue('1.2');
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(original);
  await savePreferences(page);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey);
  expect(saved).toMatchObject({ position: 'left', scale: 1, weatherScale: 1.2, seconds: true, interval: 60 });
  expect(serviceMutations).toEqual([]);
  await page.reload();
  await page.locator('#open-settings').click();
  await categoryTab(page, 'weather'); await expect(page.getByLabel('Weather scale', { exact: true })).toHaveValue('1.2');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await expect(page.getByLabel('Show seconds', { exact: true })).toBeChecked();
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await expect(page.getByLabel('Interval (seconds)', { exact: true })).toHaveValue('60');
});

test('saving validates only the active category without losing invalid drafts elsewhere', async ({ page }) => {
  await page.goto('/');
  await page.locator('#open-settings').click();
  const original = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  await categoryTab(page, 'weather'); await page.getByLabel('Weather scale', { exact: true }).fill('0.1');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Timezone', { exact: true }).fill('');
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await page.getByLabel('Interval (seconds)', { exact: true }).fill('120');
  await savePreferences(page); const save = page.locator('#save-preferences'); await categoryTab(page, 'weather'); await save.click();
  await expect(page.getByRole('tab', { name: 'Weather', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Weather scale', { exact: true })).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).not.toBe(original);
  await page.getByLabel('Weather scale', { exact: true }).fill('1.3');
  await page.locator('#reload-shared-preferences').click(); await expect(page.locator('#settings-status')).toContainText('Weather settings reloaded.'); await page.getByLabel('Weather scale', { exact: true }).fill('1.3'); await savePreferences(page); await categoryTab(page, 'time'); await save.click();
  await expect(page.getByRole('tab', { name: 'Time', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Timezone', { exact: true })).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).not.toBe(original);
  await page.locator('#reload-shared-preferences').click(); await expect(page.locator('#settings-status')).toContainText('Time settings reloaded.'); await page.getByLabel('Timezone', { exact: true }).fill('UTC');
  await savePreferences(page);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).preferences, settingsKey)).toMatchObject({ scale: 1, weatherScale: 1.3, timezone: 'UTC', interval: 120 });
});

test('native form ownership isolates display preferences from search and calendar fields', async ({ page }) => {
  await page.goto('/');
  const ownership = await page.evaluate(() => {
    const preferences = document.getElementById('preferences');
    return {
      names: [...preferences.elements].filter((control) => control.name).map((control) => control.name),
      search: document.getElementById('location-query').form.id,
      calendar: document.getElementById('calendar-url').form.id,
      password: document.getElementById('calendar-password').form.id,
      save: document.querySelector('.settings-save').form.id,
      nested: document.querySelectorAll('form form').length
    };
  });
  for (const name of ['timezone', 'temperature', 'calendarVisible', 'interval']) expect(ownership.names).toContain(name);
  for (const name of ['position', 'scale']) expect(ownership.names).not.toContain(name);
  expect(ownership.names).not.toContain('serverUrl');
  expect(ownership.names).not.toContain('password');
  expect(ownership).toMatchObject({ search: 'location-search', calendar: 'calendar-connection', password: 'calendar-connection', save: 'preferences', nested: 0 });
  await page.locator('#open-settings').click();
  await savePreferences(page);
});

test('Clear results preserves the selected weather location, displayed weather, query, and drafts', async ({ page }) => {
  await page.clock.setFixedTime(instant);
  const weatherMock = await mockWeather(page);
  const weatherRequests = weatherMock.requests;
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    window.preferenceWrites = 0;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) window.preferenceWrites++;
      return setItem.call(this, name, value);
    };
  }, settingsKey);
  await page.route('https://geocoding-api.open-meteo.com/v1/search?*', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name');
    const location = name === 'Paris' ? { name: 'Paris', latitude: 48.85, longitude: 2.35, country: 'France' } : { name: 'London', latitude: 51, longitude: 0, country: 'United Kingdom' };
    return route.fulfill({ json: { results: [location] } });
  });
  await page.goto('/');
  await page.locator('#open-settings').click();
  await categoryTab(page, 'time'); await page.getByLabel('Clock scale', { exact: true }).fill('1.4');
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await page.getByLabel('City or place', { exact: true }).fill('London');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'London, United Kingdom', exact: true }).click();
  await expect(page.locator('#search-status')).toHaveText('Selected London, United Kingdom.');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 20');
  const stored = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  expect(weatherMock.getState().location).toMatchObject({ latitude: 51, longitude: 0 });
  expect(stored).not.toBeNull();
  const writes = await page.evaluate(() => window.preferenceWrites);
  const requests = { ...weatherRequests };
  const weather = await page.locator('#weather').textContent();
  const preferenceStatus = await page.locator('#settings-status').textContent();
  await page.getByRole('button', { name: 'Clear results', exact: true }).click();
  await expect(page.locator('#search-status')).toHaveText('Search results cleared.');
  await expect(page.locator('#location-results li')).toHaveCount(0);
  await expect(page.locator('#location-query')).toHaveValue('London');
  await expect(page.locator('#weather')).toBeVisible();
  expect(await page.locator('#weather').textContent()).toBe(weather);
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(stored);
  expect(await page.evaluate(() => window.preferenceWrites)).toBe(writes);
  expect(weatherRequests).toEqual(requests);
  await expect(page.locator('#settings-status')).toHaveText(preferenceStatus);
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await expect(page.getByLabel('Clock scale', { exact: true })).toHaveValue('1.4');
  await page.reload();
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(stored);
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await page.getByLabel('City or place', { exact: true }).fill('Paris');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Paris, France', exact: true }).click();
  await expect(page.locator('#search-status')).toHaveText('Selected Paris, France.');
  expect(weatherMock.getState().location).toMatchObject({ label: 'Paris, France', latitude: 48.85, longitude: 2.35 });
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(stored);
});

test('Clear results does not cancel a pending shared-location save or restore its search status', async ({ page }) => {
  const mock = await mockWeather(page);
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  await page.route('https://geocoding-api.open-meteo.com/v1/search?*', (route) => route.fulfill({ json: { results: [{ name: 'Paris', latitude: 48.85, longitude: 2.35 }] } }));
  await page.route('**/api/weather/location', async (route) => {
    const body = route.request().postDataJSON();
    await pending;
    mock.setState({ location: body.location, revision: body.revision + 1 });
    await route.fulfill({ json: mock.getState() });
  });
  await page.goto('/');
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await page.getByLabel('City or place', { exact: true }).fill('Paris');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Paris', exact: true }).click();
  await expect(page.locator('#location-settings-status')).toHaveText('Saving weather location…');
  await page.getByRole('button', { name: 'Clear results', exact: true }).click();
  finish();
  await expect(page.locator('#current-location')).toHaveText('Current location: Paris');
  await expect(page.locator('#location-settings-status')).toHaveText('Saved Paris on this server.');
  await expect(page.locator('#search-status')).toHaveText('Search results cleared.');
  await expect(page.locator('#location-results li')).toHaveCount(0);
  await expect(page.getByLabel('City or place', { exact: true })).toHaveValue('Paris');
});

for (const outcome of ['success', 'failure']) test(`Clear results ignores a late search ${outcome} and stays safe without a selected location`, async ({ page }) => {
  await page.addInitScript(() => {
    const fetchImpl = window.fetch.bind(window);
    const requests = [];
    window.geocodingTest = {
      requests,
      async settle(index, failure) {
        const request = requests[index];
        if (request.settled) return;
        request.settled = true;
        if (failure) request.reject(new Error('Search unavailable'));
        else request.resolve({ ok: true, json: async () => ({ results: [{ name: 'London', latitude: 51, longitude: 0 }] }) });
        // The next frame runs after the search handler's awaited microtasks finish.
        await new Promise(requestAnimationFrame);
      }
    };
    window.fetch = (url, options = {}) => {
      if (new URL(url, location.href).hostname !== 'geocoding-api.open-meteo.com') return fetchImpl(url, options);
      // Deliberately resolve even when aborted to exercise the UI generation guard.
      return new Promise((resolve, reject) => requests.push({ resolve, reject, signal: options.signal, settled: false }));
    };
  });
  await page.goto('/');
  try {
    await expect(page.locator('#weather-status')).toHaveText('Choose a location in Settings to show weather.');
    const stored = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
    expect(stored).not.toBeNull();
    await page.locator('#open-settings').click();
    await page.getByRole('tab', { name: 'Weather', exact: true }).click();
    await page.getByLabel('City or place', { exact: true }).fill('London');
    const clear = page.getByRole('button', { name: 'Clear results', exact: true });
    await clear.click();
    expect(await page.evaluate(() => window.geocodingTest.requests.length)).toBe(0);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('#search-status')).toHaveText('Searching…');
    await expect.poll(() => page.evaluate(() => window.geocodingTest.requests.length)).toBe(1);
    await clear.click();
    await clear.click();
    expect(await page.evaluate(() => window.geocodingTest.requests[0].signal.aborted)).toBe(true);
    await page.evaluate((failure) => window.geocodingTest.settle(0, failure), outcome === 'failure');
    await expect(page.locator('#location-results li')).toHaveCount(0);
    await expect(page.locator('#search-status')).toHaveText('Search results cleared.');
    await expect(page.locator('#location-query')).toHaveValue('London');
    expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(stored);
    await expect(page.locator('#weather-status')).toHaveText('Choose a location in Settings to show weather.');
    expect(await page.evaluate(() => window.geocodingTest.requests.length)).toBe(1);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.geocodingTest.requests.length)).toBe(2);
    await page.evaluate(() => window.geocodingTest.settle(1, false));
    await expect(page.getByRole('button', { name: 'London', exact: true })).toBeVisible();
  } finally {
    if (!page.isClosed()) await page.evaluate(() => Promise.all(window.geocodingTest.requests.map((_, index) => window.geocodingTest.settle(index, true))));
  }
});

test('fresh browsers show server location and ignore a conflicting local location', async ({ page }) => {
  await mockWeather(page);
  await seedPreferences(page, { timezone: 'UTC', location: { latitude: 35, longitude: 139, label: 'Wrong local Tokyo' } });
  await page.goto('/');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await expect(page.locator('#weather-updated')).toHaveAttribute('datetime', instant.toISOString());
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.locator('#current-location')).toHaveText('Current location: London');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.locator('#current-location')).toHaveText('Current location: London');
});

for (const width of [601, 600]) test(`hourly and daily visibility save independently without weather requests at ${width}px`, async ({ page }) => {
  await page.clock.install({ time: instant }); await page.setViewportSize({ width, height: 900 });
  const mock = await mockWeather(page); await page.goto('/');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await expect(page.locator('#daily .forecast-item')).toHaveCount(7);
  await expect.poll(() => mock.requests.refresh).toBe(1);
  const requests = { ...mock.requests };
  for (const [hourly, daily] of [[false, true], [true, false], [false, false], [true, true]]) {
    const before = await page.locator('#hourly').evaluate(node => node.hidden);
    await page.locator('#open-settings').click(); await page.locator('#settings-tab-weather').click();
    await page.locator('[name="weatherHourlyVisible"]').setChecked(hourly); await page.locator('[name="weatherDailyVisible"]').setChecked(daily);
    expect(await page.locator('#hourly').evaluate(node => node.hidden)).toBe(before);
    await savePreferences(page);
    await page.locator('#close-settings').click();
    await expect(page.locator('#hourly')).toBeVisible({ visible: hourly }); await expect(page.locator('#daily')).toBeVisible({ visible: daily });
    await expect(page.locator('#forecast-details')).toBeVisible({ visible: hourly || daily });
    await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
    await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 20'); await expect(page.locator('#weather-updated')).toBeVisible();
    await page.bringToFront(); await page.locator('#fullscreen').click(); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(page.locator('#hourly')).toBeVisible({ visible: hourly }); await expect(page.locator('#daily')).toBeVisible({ visible: daily });
    await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C'); await page.evaluate(() => document.exitFullscreen());
    expect(mock.requests).toEqual(requests);
  }
  await page.reload(); await expect(page.locator('#hourly')).toBeVisible(); await expect(page.locator('#daily')).toBeVisible();
});

test('remote forecast changes retain dirty drafts and survive empty, stale, and later weather snapshots', async ({ page }) => {
  await page.clock.install({ time: instant });
  const remote = await mockSharedSettings(page); const mock = await mockWeather(page); await page.goto('/');
  await expect(page.locator('#hourly')).toBeVisible();
  await page.locator('#open-settings').click(); await page.locator('#settings-tab-weather').click(); await page.locator('[name="weatherDailyVisible"]').uncheck();
  remote.setPreferences({ weatherHourlyVisible: false, weatherDailyVisible: false }); await page.clock.fastForward(5000);
  await expect(page.locator('#forecast-details')).toBeHidden(); await expect(page.locator('[name="weatherHourlyVisible"]')).toBeChecked();
  await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toContainText('changed');
  await page.locator('#reload-shared-preferences').click(); await expect(page.locator('[name="weatherHourlyVisible"]')).not.toBeChecked();
  await page.locator('#close-settings').click();
  const empty = normalizeForecast(rawForecast(18)); empty.hourly = []; empty.daily = [];
  mock.setState({ forecast: empty, forecastError: true }); await page.clock.fastForward(60000);
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('18 °C'); await expect(page.locator('#forecast-details')).toBeHidden();
  remote.setPreferences({ weatherDailyVisible: true }); await page.clock.fastForward(5000);
  await expect(page.locator('#daily')).toHaveText('Daily forecast unavailable.'); await expect(page.locator('#hourly')).toBeHidden();
  await expect(page.locator('#weather-status')).toContainText('stale');
  mock.setState({ forecast: normalizeForecast(rawForecast(21)), forecastError: false }); await page.clock.fastForward(60000);
  await expect(page.locator('#daily .forecast-item')).toHaveCount(7); await expect(page.locator('#hourly')).toBeHidden();
  mock.setState({ forecast: null, forecastUpdated: null, forecastError: true }); await page.clock.fastForward(60000);
  await expect(page.locator('#forecast-details')).toBeHidden();
  await page.reload(); await expect(page.locator('#forecast-details')).toBeHidden();
  await page.locator('#open-settings').click(); await page.locator('#settings-tab-weather').click();
  await expect(page.locator('[name="weatherHourlyVisible"]')).not.toBeChecked(); await expect(page.locator('[name="weatherDailyVisible"]')).toBeChecked();
});

test('air quality recovers from unavailable to zero and retains stale readings independently of forecasts', async ({ page }) => {
  await page.clock.install({ time: instant });
  const mock = await mockWeather(page); mock.setState({ air: null, airUpdated: null, airError: true });
  await page.goto('/');
  await expect(page.locator('#current-weather-subvalues')).toContainText('Air quality unavailable.');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  mock.setState({ air: { aqi: 0 }, airUpdated: instant.getTime() + 3600000, airError: false });
  await page.clock.fastForward(60000);
  await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 0');
  await expect(page.locator('#current-weather-subvalues')).not.toContainText('Air quality unavailable');
  mock.setState({ airError: true }); await page.clock.fastForward(60000);
  await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 0 (stale; refresh failed)');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await expect(page.locator('#weather-updated')).toHaveAttribute('datetime', instant.toISOString());
});

test('successful air quality remains visible when the first forecast fails', async ({ page }) => {
  const mock = await mockWeather(page);
  mock.setState({ forecast: null, forecastUpdated: null, forecastError: true });
  await page.goto('/');
  await expect(page.locator('#weather-status')).toHaveText('Forecast unavailable. Retrying hourly.');
  await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 20');
  await expect(page.locator('#weather-updated')).toBeHidden();
  await expect(page.locator('#forecast-details')).toBeHidden();
});

test('cached weather and update time appear before a background refresh and survive air-only failure updates', async ({ page }) => {
  await page.clock.install({ time: instant });
  await seedPreferences(page, { timezone: 'UTC', hour12: false });
  const mock = await mockWeather(page); mock.setState({ refreshing: true });
  await page.goto('/');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await expect(page.locator('#weather-updated')).toHaveAttribute('datetime', instant.toISOString());
  await expect(page.locator('#weather-status')).toHaveText('Updating weather…');
  mock.setState({ refreshing: false, forecastError: true, air: { aqi: 30 }, airUpdated: instant.getTime() + 60000 });
  await page.clock.fastForward(5000);
  await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 30');
  await expect(page.locator('#weather-status')).toContainText('Forecast is stale');
  await expect(page.locator('#weather-updated')).toHaveAttribute('datetime', instant.toISOString());
  const updated = new Date(instant.getTime() + 3600000);
  mock.setState({ forecast: normalizeForecast(rawForecast(18)), forecastUpdated: updated.getTime(), forecastError: false });
  await page.clock.fastForward(60000);
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('18 °C');
  await expect(page.locator('#weather-updated')).toHaveAttribute('datetime', updated.toISOString());
  await page.reload();
  await expect(page.locator('#weather-updated')).toHaveAttribute('datetime', updated.toISOString());
});

test('Settings reloads another browser location and polling preserves open preference drafts', async ({ page }) => {
  await page.clock.install({ time: instant });
  const mock = await mockWeather(page);
  await page.goto('/');
  await page.locator('#open-settings').click();
  await categoryTab(page, 'time'); await page.getByLabel('Clock scale', { exact: true }).fill('1.4');
  await expect.poll(() => mock.requests.snapshot).toBe(1);
  mock.setState({ revision: 2, location: { label: 'Paris', latitude: 48.85, longitude: 2.35 }, forecast: normalizeForecast(rawForecast(21)) });
  await page.clock.runFor(60000);
  await expect(page.getByLabel('Clock scale', { exact: true })).toHaveValue('1.4');
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.locator('#current-location')).toHaveText('Current location: Paris');
  await page.locator('#close-settings').click();
  mock.setState({ revision: 3, location: { label: 'Tokyo', latitude: 35, longitude: 139 } });
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.locator('#current-location')).toHaveText('Current location: Tokyo');
  expect(await page.evaluate(() => localStorage.getItem('dashboard.preferences.v1'))).toBeNull();
});

for (const status of [503, 409]) test(`location save ${status} retains authoritative weather and reports the error`, async ({ page }) => {
  const mock = await mockWeather(page);
  await page.route('https://geocoding-api.open-meteo.com/v1/search?*', (route) => route.fulfill({ json: { results: [{ name: 'Paris', latitude: 48.85, longitude: 2.35 }] } }));
  await page.route('**/api/weather/location', (route) => {
    if (status === 409) mock.setState({ revision: 2, location: { label: 'Tokyo', latitude: 35, longitude: 139 } });
    return route.fulfill({ status, json: { error: status === 409 ? 'Weather location changed on another device. Reload and select the location again.' : 'Weather location could not be saved.' } });
  });
  await page.goto('/');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await page.getByLabel('City or place', { exact: true }).fill('Paris');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Paris', exact: true }).click();
  await expect(page.locator('#location-settings-status')).toContainText(status === 409 ? 'changed on another device' : 'could not be saved');
  await expect(page.locator('#current-location')).toHaveText(`Current location: ${status === 409 ? 'Tokyo' : 'London'}`);
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  expect(await page.evaluate(() => localStorage.getItem('dashboard.preferences.v1'))).toBeNull();
});

test('different browsers present canonical weather in their own units and timezones', async ({ page, browser }) => {
  await seedPreferences(page, { timezone: 'UTC', hour12: false }); await mockWeather(page);
  await page.goto('/');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  const firstTime = await page.locator('#weather-updated').textContent();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await seedPreferences(other, { timezone: 'Asia/Tokyo', temperature: 'fahrenheit', wind: 'kn', precipitation: 'inch', hour12: false });
    await mockWeather(other);
    await mockSharedSettings(other);
    await other.route('**/api/calendar', (route) => route.fulfill({ json: { configured: false, encryptionReady: true } }));
    await mockSlideshow(other);
    await other.goto('/');
    await expect(other.locator('#current-weather-values .temperature')).toHaveText('53.6 °F');
    await expect(other.locator('#current-weather-subvalues')).toContainText('Wind 4.3 kn');
    await expect(other.locator('#current-weather-subvalues')).toContainText('Precipitation 1 inch');
    await expect(other.locator('#daily .forecast-temperature').first()).toHaveText('46.4°F/59°F');
    await expect(other.locator('#weather-updated')).toHaveAttribute('datetime', instant.toISOString());
    expect(await other.locator('#weather-updated').textContent()).not.toBe(firstTime);
    await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  } finally { await otherContext.close(); }
});

test('Calendar connects and disconnects using only credentials from its independent form', async ({ page }) => {
  const mutations = [];
  let configured = false;
  await page.route('**/api/calendar', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      mutations.push(request.postDataJSON()); configured = true;
    } else if (request.method() === 'DELETE') {
      mutations.push('DELETE'); configured = false;
      await route.fulfill({ status: 204 }); return;
    }
    await route.fulfill({ json: { configured, encryptionReady: true, serverUrl: configured ? 'https://baikal.example.test' : '', username: configured ? 'calendar' : '', events: [] } });
  });
  await page.route('**/api/calendar/events', (route) => route.fulfill({ json: { configured: true, events: [] } }));
  await page.goto('/');
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Baikal server URL', { exact: true }).fill('https://baikal.example.test');
  await page.getByLabel('Username', { exact: true }).fill('calendar');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Clock scale', { exact: true }).fill('0.1');
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('test-password');
  await page.getByRole('button', { name: 'Connect calendar', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  expect(mutations).toEqual([{ serverUrl: 'https://baikal.example.test', username: 'calendar', password: 'test-password' }]);
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Baikal server URL', { exact: true })).toHaveValue('https://baikal.example.test');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect calendar', exact: true }).click();
  await expect(page.locator('#calendar-settings-status')).toHaveText('Calendar disconnected.');
  expect(mutations.at(-1)).toBe('DELETE');
  await expect(page.getByRole('button', { name: 'Disconnect calendar', exact: true })).toBeDisabled();
});

test('service errors and in-flight credential edits remain available after switching tabs', async ({ page }) => {
  await page.route('https://geocoding-api.open-meteo.com/v1/search?*', (route) => route.fulfill({ status: 503, json: { error: true } }));
  let finishConnection;
  const connectionPending = new Promise((resolve) => { finishConnection = resolve; });
  await page.route('**/api/calendar', async (route) => {
    if (route.request().method() === 'PUT') {
      await connectionPending;
      await route.fulfill({ status: 400, json: { error: 'Calendar connection failed.' } });
    } else await route.fulfill({ json: { configured: false, encryptionReady: true } });
  });
  await page.goto('/');
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await page.getByLabel('City or place', { exact: true }).fill('London');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('#search-status')).toHaveText('Location search unavailable. Please try again.');
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Baikal server URL', { exact: true }).fill('https://baikal.example.test');
  await page.getByLabel('Username', { exact: true }).fill('calendar');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Connect calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect calendar', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.locator('#search-status')).toHaveText('Location search unavailable. Please try again.');
  finishConnection();
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('#calendar-settings-status')).toHaveText('Calendar connection failed.');
  await expect(page.getByRole('button', { name: 'Connect calendar', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('wrong-password');
});
