import { test, expect, firefox } from '@playwright/test';
import { once } from 'node:events';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createWeatherService } from '../src/weather.js';
import { rawForecast } from '../test/fixtures/weather.js';

const instant = new Date('2026-10-11T12:00:00Z');
const cacheKey = 'dashboard.shared-settings.v1';
async function environment() {
  const store = createStore(':memory:');
  const weather = createWeatherService({ store, fetchImpl: async (url) => Response.json(url.hostname.startsWith('air-') ? { current: { us_aqi: 20 } } : rawForecast()) }); weather.start();
  let blockConnection; let releaseConnection;
  const event = { title: 'Shared calendar event', start: '2026-10-11T13:00:00Z', end: '2026-10-11T14:00:00Z', allDay: false };
  const calDav = { clearCache() {}, async test() { if (blockConnection) await new Promise((resolve) => { releaseConnection = resolve; }); return { events: [event] }; }, listEvents: async () => ({ events: [event], stale: false }) };
  const linkwarden = { clearCache() {}, listCollections: async () => [{ id: 1, name: 'Root', children: [] }], getBookmarks: async () => ({ bookmarks: [{ id: 1, name: 'Shared bookmark', url: 'https://example.test' }], stale: false }) };
  const server = createDashboardServer({ store, weather, calDav, linkwarden, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: Buffer.alloc(32, 9).toString('base64') } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  return { store, base, blockCalendar() { blockConnection = true; }, releaseCalendar() { blockConnection = false; releaseConnection?.(); }, async close() { releaseConnection?.(); await new Promise((resolve) => server.close(resolve)); await weather.stop(); store.close(); } };
}
async function client(browser, env, { legacy, mobile = false } = {}) {
  const context = await browser.newContext({ baseURL: env.base, locale: 'en-US', viewport: { width: mobile ? 390 : 1200, height: 800 } });
  if (legacy) await context.addInitScript((value) => { if (!localStorage.getItem('dashboard.preferences.v1')) localStorage.setItem('dashboard.preferences.v1', JSON.stringify(value)); }, legacy);
  const page = await context.newPage(); await page.clock.install({ time: instant });
  await page.goto('/'); await expect(page.locator('#settings-status')).toHaveText('Preferences are shared across all browsers.');
  return { page, close: () => context.close() };
}
const preferences = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key))?.preferences, cacheKey);
async function open(page, tab = 'General') { await page.locator('#open-settings').click(); await page.getByRole('tab', { name: tab, exact: true }).click(); }
async function save(page) { await page.getByRole('button', { name: 'Save preferences', exact: true }).click(); await expect(page.locator('#settings-status')).toHaveText('Preferences saved for all browsers.'); }
async function tick(page) { await page.clock.fastForward(5000); }

test('all Settings categories share through a real server across isolated desktop/mobile clients', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); const b = await client(browser, env, { mobile: true });
  try {
    await open(a.page); await a.page.getByRole('combobox', { name: 'Position', exact: true }).selectOption('right'); await a.page.getByLabel('Overall scale', { exact: true }).fill('1.2');
    await a.page.getByRole('tab', { name: 'Time', exact: true }).click(); await a.page.getByLabel('Timezone', { exact: true }).fill('Asia/Tokyo'); await a.page.getByLabel('Show seconds', { exact: true }).uncheck(); await a.page.getByLabel('Show clock on mobile', { exact: true }).uncheck();
    await a.page.getByRole('tab', { name: 'Weather', exact: true }).click(); await a.page.getByRole('combobox', { name: 'Temperature', exact: true }).selectOption('fahrenheit'); await a.page.getByLabel('Weather scale on mobile', { exact: true }).fill('1.3');
    await a.page.getByRole('tab', { name: 'Calendar', exact: true }).click(); await a.page.getByLabel('Calendar scale', { exact: true }).fill('1.2');
    await a.page.getByRole('tab', { name: 'Bookmarks', exact: true }).click(); await a.page.getByRole('combobox', { name: 'Mobile bookmark display', exact: true }).selectOption('expanded'); await a.page.getByLabel('Hide bookmarks in fullscreen', { exact: true }).check();
    await a.page.getByRole('tab', { name: 'Images', exact: true }).click(); await a.page.getByLabel('Background color', { exact: true }).fill('#123456'); await a.page.getByLabel('Interval (seconds)', { exact: true }).fill('120'); await save(a.page);
    await tick(b.page); await expect(b.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)'); await expect(b.page.locator('#clock')).toBeHidden(); await expect(b.page.locator('#weather')).toHaveCSS('font-size', '20.8px');
    expect(await preferences(b.page)).toEqual(env.store.getDashboardPreferences().preferences);
    const fresh = await client(browser, env, { legacy: { color: '#abcdef', timezone: 'UTC' } });
    try { expect(await preferences(fresh.page)).toEqual(await preferences(b.page)); expect(await fresh.page.evaluate(() => localStorage.getItem('dashboard.preferences.v1'))).toBeNull(); } finally { await fresh.close(); }
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('concurrent dialogs preserve drafts, reject stale saves, and explicitly reload without resetting credential drafts', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); const b = await client(browser, env);
  try {
    await open(a.page); await open(b.page); await b.page.getByLabel('Overall scale', { exact: true }).fill('1.7');
    await b.page.getByRole('tab', { name: 'Bookmarks', exact: true }).click(); await b.page.getByLabel('Linkwarden URL', { exact: true }).fill('https://draft.test'); await b.page.getByRole('tab', { name: 'General', exact: true }).click();
    await a.page.getByRole('tab', { name: 'Images', exact: true }).click(); await a.page.getByLabel('Background color', { exact: true }).fill('#123456'); await save(a.page);
    await tick(b.page); await expect(b.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)'); await expect(b.page.getByLabel('Overall scale', { exact: true })).toHaveValue('1.7');
    await b.page.getByRole('button', { name: 'Save preferences', exact: true }).click(); await expect(b.page.locator('#settings-status')).toContainText('changed in another browser');
    expect(env.store.getDashboardPreferences().preferences.scale).toBe(1);
    await b.page.getByRole('button', { name: 'Reload shared preferences', exact: true }).click(); await expect(b.page.getByLabel('Overall scale', { exact: true })).toHaveValue('1');
    await b.page.getByRole('tab', { name: 'Bookmarks', exact: true }).click(); await expect(b.page.getByLabel('Linkwarden URL', { exact: true })).toHaveValue('https://draft.test'); await b.page.getByRole('tab', { name: 'General', exact: true }).click();
    await b.page.getByLabel('Overall scale', { exact: true }).fill('1.7'); await save(b.page); expect(env.store.getDashboardPreferences().preferences.color).toBe('#123456');
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('one-time legacy migration converges independently stored clients on the winning record', async ({ browser }) => {
  const env = await environment();
  const [a, b] = await Promise.all([client(browser, env, { legacy: { color: '#123456', timeScale: 1.25 } }), client(browser, env, { legacy: { color: '#abcdef', timezone: 'Europe/London' } })]);
  try { await tick(a.page); await tick(b.page); await expect.poll(() => preferences(a.page)).toEqual(env.store.getDashboardPreferences().preferences); expect(await preferences(b.page)).toEqual(await preferences(a.page)); expect(env.store.getDashboardPreferences().revision).toBe(1); }
  finally { await a.close(); await b.close(); await env.close(); }
});

test('remote connections and disconnects are discovered by initially unconfigured clients', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); const b = await client(browser, env);
  try {
    await a.page.route('https://geocoding-api.open-meteo.com/v1/search?*', (route) => route.fulfill({ json: { results: [{ name: 'London', latitude: 51, longitude: 0 }] } }));
    await open(a.page, 'Weather'); await a.page.getByLabel('City or place', { exact: true }).fill('London'); await a.page.getByRole('button', { name: 'Search', exact: true }).click(); await a.page.getByRole('button', { name: 'London', exact: true }).click(); await expect(a.page.locator('#location-settings-status')).toHaveText('Saved London on this server.');
    await tick(b.page); await expect(b.page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
    await a.page.locator('#close-settings').click();
    await open(a.page, 'Calendar'); await a.page.getByLabel('Baikal server URL', { exact: true }).fill('https://calendar.test'); await a.page.getByLabel('Username', { exact: true }).fill('sam'); await a.page.getByLabel('Password', { exact: true }).fill('private-password'); await a.page.getByRole('button', { name: 'Connect calendar', exact: true }).click(); await expect(a.page.locator('#settings-dialog')).toBeHidden();
    await tick(b.page); await expect(b.page.locator('#calendar-events')).toContainText('Shared calendar event');
    await open(a.page, 'Bookmarks'); await a.page.getByLabel('Linkwarden URL', { exact: true }).fill('https://links.test'); await a.page.getByLabel('Linkwarden username', { exact: true }).fill('sam'); await a.page.getByLabel('Linkwarden access token', { exact: true }).fill('private-token'); await a.page.getByRole('button', { name: 'Connect Linkwarden', exact: true }).click(); await expect(a.page.locator('#linkwarden-settings-status')).toHaveText('Linkwarden connected.');
    await tick(b.page); await expect(b.page.getByRole('link', { name: 'Shared bookmark', exact: true })).toBeVisible();
    expect(await b.page.evaluate(() => Object.keys(localStorage).map((key) => localStorage.getItem(key)).join(''))).not.toContain('private-');
    a.page.once('dialog', (dialog) => dialog.accept()); await a.page.getByRole('button', { name: 'Disconnect Linkwarden', exact: true }).click(); await expect(a.page.locator('#linkwarden-settings-status')).toHaveText('Linkwarden disconnected.');
    await tick(b.page); await expect(b.page.locator('#bookmark-tree a')).toHaveCount(0);
    await a.page.getByRole('tab', { name: 'Calendar', exact: true }).click(); a.page.once('dialog', (dialog) => dialog.accept()); await a.page.getByRole('button', { name: 'Disconnect calendar', exact: true }).click(); await expect(a.page.locator('#calendar-settings-status')).toHaveText('Calendar disconnected.');
    await tick(b.page); await expect(b.page.locator('#calendar-events li')).toHaveCount(0);
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('a local pending connection does not block remote preference synchronization', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); const b = await client(browser, env);
  try {
    env.blockCalendar(); await open(b.page, 'Calendar'); await b.page.getByLabel('Baikal server URL', { exact: true }).fill('https://calendar.test'); await b.page.getByLabel('Username', { exact: true }).fill('sam'); await b.page.getByLabel('Password', { exact: true }).fill('private-password'); await b.page.getByRole('button', { name: 'Connect calendar', exact: true }).click(); await expect(b.page.getByRole('button', { name: 'Connect calendar', exact: true })).toBeDisabled();
    await open(a.page, 'Images'); await a.page.getByLabel('Background color', { exact: true }).fill('#123456'); await save(a.page);
    await tick(b.page); await expect(b.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)'); await expect(b.page.getByRole('button', { name: 'Connect calendar', exact: true })).toBeDisabled();
    env.releaseCalendar(); await expect(b.page.locator('#settings-dialog')).toBeHidden();
  } finally { env.releaseCalendar(); await a.close(); await b.close(); await env.close(); }
});

test('Firefox and Chromium exchange saved preferences through the same server', async ({ browser }) => {
  const secondary = await firefox.launch(); const env = await environment(); const chrome = await client(browser, env); const fox = await client(secondary, env);
  try {
    await open(fox.page, 'Images'); await fox.page.getByLabel('Background color', { exact: true }).fill('#123456'); await save(fox.page); await tick(chrome.page); await expect(chrome.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await open(chrome.page); await chrome.page.getByLabel('Overall scale', { exact: true }).fill('1.4'); await save(chrome.page); await tick(fox.page); await expect.poll(() => preferences(fox.page)).toEqual(env.store.getDashboardPreferences().preferences);
  } finally { await chrome.close(); await fox.close(); await secondary.close(); await env.close(); }
});
