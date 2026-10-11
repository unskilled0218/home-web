import { expect, test as base } from '@playwright/test';

const settingsKey = 'dashboard.preferences.v1';
const instant = new Date('2026-10-11T12:00:00Z');
const photoUrl = '/api/dashboard/photos/abcdefghijklmnop';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
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
  const epoch = instant.getTime() / 1000;
  await page.route('https://api.open-meteo.com/v1/forecast?*', (route) => route.fulfill({ json: {
    current: { time: epoch, temperature_2m: 12, weather_code: 0, is_day: 1, wind_speed_10m: 8, relative_humidity_2m: 50, precipitation: 0 },
    current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', relative_humidity_2m: '%', precipitation: 'mm' },
    hourly: { time: Array.from({ length: 25 }, (_, index) => epoch + index * 3600), temperature_2m: Array(25).fill(13), weather_code: Array(25).fill(2), is_day: Array(25).fill(1) },
    hourly_units: { temperature_2m: '°C' },
    daily: { time: Array.from({ length: 7 }, (_, index) => epoch + index * 86400), temperature_2m_min: Array(7).fill(8), temperature_2m_max: Array(7).fill(15), weather_code: Array(7).fill(2) },
    daily_units: { temperature_2m_max: '°C' }, utc_offset_seconds: 0
  } }));
  await page.route('https://air-quality-api.open-meteo.com/v1/air-quality?*', (route) => route.fulfill({ json: { current: { us_aqi: 20 } } }));
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
