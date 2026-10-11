import { expect, test as base } from '@playwright/test';

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
    await use(page);
    expect(errors, 'dashboard initializes and handles interactions without page errors').toEqual([]);
  }
});

async function seedPreferences(page, preferences) {
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
  }, { key: settingsKey, value: preferences });
}

async function mockWeather(page) {
  const requests = { forecast: 0, air: 0 };
  const epoch = instant.getTime() / 1000;
  await page.route('https://api.open-meteo.com/v1/forecast?*', (route) => {
    requests.forecast++;
    return route.fulfill({ json: {
      current: { time: epoch, temperature_2m: 12, weather_code: 0, is_day: 1, wind_speed_10m: 8, relative_humidity_2m: 50, precipitation: 0 },
      current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', relative_humidity_2m: '%', precipitation: 'mm' },
      hourly: { time: Array.from({ length: 25 }, (_, index) => epoch + index * 3600), temperature_2m: Array(25).fill(13), weather_code: Array(25).fill(2), is_day: Array(25).fill(1) },
      hourly_units: { temperature_2m: '°C' },
      daily: { time: Array.from({ length: 7 }, (_, index) => epoch + index * 86400), temperature_2m_min: Array(7).fill(8), temperature_2m_max: Array(7).fill(15), weather_code: Array(7).fill(2) },
      daily_units: { temperature_2m_max: '°C' }, utc_offset_seconds: 0
    } });
  });
  await page.route('https://air-quality-api.open-meteo.com/v1/air-quality?*', (route) => {
    requests.air++;
    return route.fulfill({ json: { current: { us_aqi: 20 } } });
  });
  return requests;
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
  await expect(page.getByLabel('Position', { exact: true })).toBeFocused();
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
  await page.getByLabel('Position', { exact: true }).selectOption('right');
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
  const weatherRequests = await mockWeather(page);
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
  const selected = JSON.parse(stored);
  expect(selected.location).toMatchObject({ latitude: 51, longitude: 0 });
  expect(selected.scale).toBe(1);
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
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).location, settingsKey)).toMatchObject({ label: 'Paris, France', latitude: 48.85, longitude: 2.35 });
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
