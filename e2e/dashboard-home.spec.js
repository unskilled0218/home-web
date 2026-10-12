import { expect, test as base } from '@playwright/test';
import { normalizeForecast } from '../public/weather-data.js';
import { rawForecast } from '../test/fixtures/weather.js';

const settingsKey = 'dashboard.preferences.v1';
const instant = new Date('2026-10-11T12:00:00Z');
const photoUrl = '/api/dashboard/photos/abcdefghijklmnop';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (/invalid form control|not focusable/i.test(message.text())) errors.push(message.text()); });
    await page.route('**/api/calendar', (route) => route.fulfill({ json: { configured: false, encryptionReady: true } }));
    await page.route('**/api/dashboard/photos', (route) => route.fulfill({ json: { available: true, photos: [] } }));
    await mockWeather(page, { configured: false });
    const providerRequests = [];
    await page.route(/https:\/\/(?:api|air-quality-api)\.open-meteo\.com\//, (route) => { providerRequests.push(route.request().url()); return route.abort(); });
    await use(page);
    expect(providerRequests, 'browsers must not retrieve forecasts or air quality directly').toEqual([]);
    expect(errors, 'dashboard initializes and handles interactions without page errors').toEqual([]);
  }
});

async function seedPreferences(page, preferences) {
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
  }, { key: settingsKey, value: preferences });
}

async function mockWeather(page, { configured = true } = {}) {
  const requests = { snapshot: 0, refresh: 0, save: 0 };
  let state = { configured, revision: configured ? 1 : 0, location: configured ? { label: 'London', latitude: 51, longitude: 0 } : null, timezone: 'UTC', forecastRegistered: configured, forecast: configured ? normalizeForecast(rawForecast()) : null, air: configured ? { aqi: 20 } : null, forecastUpdated: configured ? instant.getTime() : null, airUpdated: configured ? instant.getTime() : null, forecastError: false, airError: false, refreshing: false };
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
  await expect(page.locator('#photo-status')).toHaveText('No supported photos were found on the NFS share.');
  await page.locator('#close-settings').click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('#open-settings')).toBeFocused();
  expect(retiredRequests).toEqual([]);
});

test('existing preferences load at home and edits survive reload and legacy redirects', async ({ page }) => {
  await seedPreferences(page, { position: 'right', timezone: 'UTC', timeVisible: false, color: '#123456' });
  await page.goto('/');
  await expect(page.locator('#information')).toHaveClass('right');
  await expect(page.locator('#clock')).toBeHidden();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.locator('#open-settings').click();
  await page.locator('[name="position"]').selectOption('left');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Show clock', { exact: true }).check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.locator('#settings-status')).toHaveText('Preferences saved in this browser.');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), settingsKey);
  expect(saved.position).toBe('left');
  expect(saved.timeVisible).toBe(true);
  expect(saved.color).toBe('#123456');
  await page.reload();
  await expect(page.locator('#clock')).toBeVisible();
  await expect(page.locator('#information')).not.toHaveClass('right');
  for (const route of ['/', '/dashboard', '/dashboard/', '/dashboard.html']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#information')).not.toHaveClass('right');
    await expect(page.locator('#clock')).toBeVisible();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), settingsKey)).toEqual(saved);
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
    for (const name of ['General', 'Time', 'Weather', 'Calendar', 'Images']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      const panel = page.getByRole('tabpanel', { name, exact: true });
      await expect(panel).toBeVisible();
      const tabBounds = await tab.boundingBox(); const panelBounds = await panel.boundingBox();
      expect(tabBounds.x + tabBounds.width).toBeLessThanOrEqual(panelBounds.x);
      expect(await page.locator('.settings-panels').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Save preferences', exact: true })).toBeInViewport();
      await expect(page.locator('#close-settings')).toBeInViewport();
    }
  }
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Timezone', { exact: true }).fill('UTC');
  await page.locator('[name="seconds"]').uncheck();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.locator('#settings-status')).toHaveText('Preferences saved in this browser.');
  await page.locator('#close-settings').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#home-grid, .widget-move, .widget-resize')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
});

test('home renders a decoded background, weather forecasts, and calendar events from service responses', async ({ page }) => {
  await page.clock.setFixedTime(instant);
  await seedPreferences(page, { timezone: 'UTC', imageInfo: true, animation: 'none', location: { latitude: 51, longitude: 0, label: 'London' } });
  await page.route('**/api/dashboard/photos', (route) => route.fulfill({ json: { available: true, photos: [{ name: 'sample.png', lastModified: instant.getTime(), url: photoUrl }] } }));
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
  await expect(page.locator('.page-tools')).toBeHidden();
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
  await expect(page.getByRole('combobox', { name: 'Position', exact: true })).toBeFocused();
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

test('tab switches retain drafts and saving includes hidden panels without submitting service forms', async ({ page }) => {
  const serviceMutations = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/calendar')) serviceMutations.push(request.method());
    if (request.url().includes('geocoding-api.open-meteo.com')) serviceMutations.push('search');
  });
  await page.goto('/');
  await page.locator('#open-settings').click();
  const original = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  await page.getByRole('combobox', { name: 'Position', exact: true }).selectOption('right');
  await page.getByLabel('Overall scale', { exact: true }).fill('1.2');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Show seconds', { exact: true }).uncheck();
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await page.getByLabel('Interval (seconds)', { exact: true }).fill('90');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await expect(page.getByLabel('Show seconds', { exact: true })).not.toBeChecked();
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect(page.getByLabel('Overall scale', { exact: true })).toHaveValue('1.2');
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(original);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.locator('#settings-status')).toHaveText('Preferences saved in this browser.');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), settingsKey);
  expect(saved).toMatchObject({ position: 'right', scale: 1.2, seconds: false, interval: 90 });
  expect(serviceMutations).toEqual([]);
  await page.reload();
  await page.locator('#open-settings').click();
  await expect(page.getByLabel('Overall scale', { exact: true })).toHaveValue('1.2');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await expect(page.getByLabel('Show seconds', { exact: true })).not.toBeChecked();
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await expect(page.getByLabel('Interval (seconds)', { exact: true })).toHaveValue('90');
});

test('saving reveals each hidden invalid preference without losing other drafts', async ({ page }) => {
  await page.goto('/');
  await page.locator('#open-settings').click();
  const original = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  await page.getByLabel('Overall scale', { exact: true }).fill('0.1');
  await page.getByRole('tab', { name: 'Time', exact: true }).click();
  await page.getByLabel('Timezone', { exact: true }).fill('');
  await page.getByRole('tab', { name: 'Images', exact: true }).click();
  await page.getByLabel('Interval (seconds)', { exact: true }).fill('120');
  const save = page.getByRole('button', { name: 'Save preferences', exact: true });
  await save.click();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Overall scale', { exact: true })).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(original);
  await page.getByLabel('Overall scale', { exact: true }).fill('1.3');
  await save.click();
  await expect(page.getByRole('tab', { name: 'Time', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Timezone', { exact: true })).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(original);
  await page.getByLabel('Timezone', { exact: true }).fill('UTC');
  await save.click();
  await expect(page.locator('#settings-status')).toHaveText('Preferences saved in this browser.');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), settingsKey)).toMatchObject({ scale: 1.3, timezone: 'UTC', interval: 120 });
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
  for (const name of ['position', 'scale', 'timezone', 'temperature', 'calendarVisible', 'interval']) expect(ownership.names).toContain(name);
  expect(ownership.names).not.toContain('serverUrl');
  expect(ownership.names).not.toContain('password');
  expect(ownership).toMatchObject({ search: 'location-search', calendar: 'calendar-connection', password: 'calendar-connection', save: 'preferences', nested: 0 });
  await page.locator('#open-settings').click();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.locator('#settings-status')).toHaveText('Preferences saved in this browser.');
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
  await page.getByLabel('Overall scale', { exact: true }).fill('1.4');
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await page.getByLabel('City or place', { exact: true }).fill('London');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'London, United Kingdom', exact: true }).click();
  await expect(page.locator('#search-status')).toHaveText('Selected London, United Kingdom.');
  await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
  await expect(page.locator('#current-weather-subvalues')).toContainText('US AQI: 20');
  const stored = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  expect(weatherMock.getState().location).toMatchObject({ latitude: 51, longitude: 0 });
  expect(stored).toBeNull();
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
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect(page.getByLabel('Overall scale', { exact: true })).toHaveValue('1.4');
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
    const stored = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
    expect(stored).toBeNull();
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
  await page.getByLabel('Overall scale', { exact: true }).fill('1.4');
  await expect.poll(() => mock.requests.snapshot).toBe(2);
  mock.setState({ revision: 2, location: { label: 'Paris', latitude: 48.85, longitude: 2.35 }, forecast: normalizeForecast(rawForecast(21)) });
  await page.clock.runFor(60000);
  await expect(page.getByLabel('Overall scale', { exact: true })).toHaveValue('1.4');
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.locator('#current-location')).toHaveText('Current location: Paris');
  await page.locator('#close-settings').click();
  mock.setState({ revision: 3, location: { label: 'Tokyo', latitude: 35, longitude: 139 } });
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Weather', exact: true }).click();
  await expect(page.locator('#current-location')).toHaveText('Current location: Tokyo');
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBeNull();
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
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBeNull();
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
    await other.route('**/api/calendar', (route) => route.fulfill({ json: { configured: false, encryptionReady: true } }));
    await other.route('**/api/dashboard/photos', (route) => route.fulfill({ json: { available: true, photos: [] } }));
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
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await page.getByLabel('Overall scale', { exact: true }).fill('0.1');
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
