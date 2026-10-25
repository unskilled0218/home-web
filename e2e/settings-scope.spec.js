import { test, expect } from '@playwright/test';
import { settingsEnvironment, scopeClient } from './settings-environment.js';

async function mode(page, value) {
  await page.locator('#open-settings').click(); await page.locator('#settings-scope').selectOption(value);
  await expect(page.locator('#settings-status')).toHaveText(value === 'local' ? 'Preferences apply to this browser only.' : 'Preferences are shared across all browsers.'); await page.locator('#close-settings').click();
}
async function color(page, value, global = false) {
  await page.locator('#open-settings').click(); await page.locator('#settings-tab-images').click(); await page.locator('[name="color"]').fill(value); await page.locator('#save-preferences').click();
  await expect(page.locator('#settings-status')).toHaveText(global ? 'Preferences saved for all browsers.' : 'Preferences saved for this browser.'); await page.locator('#close-settings').click();
}

test('A stays Local while B/C remain Global; local edits and switching never replace the shared record', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const b = await scopeClient(browser, env); const c = await scopeClient(browser, env);
  try {
    await expect(a.page.locator('#settings-status')).toHaveText('Preferences apply to this browser only.'); await mode(b.page, 'global'); await mode(c.page, 'global');
    const before = env.store.exportDashboardSettings(); const photo = env.slideshow.snapshot();
    await color(a.page, '#123456'); await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-time').click(); await a.page.locator('[name="timezone"]').fill('Asia/Tokyo'); await a.page.locator('[name="hour12"]').check(); await a.page.locator('#save-preferences').click(); await a.page.locator('#close-settings').click();
    expect(env.store.exportDashboardSettings()).toEqual(before); expect(env.slideshow.snapshot()).toEqual(photo); await expect(b.page.locator('body')).toHaveCSS('background-color', 'rgb(34, 34, 34)');
    await color(b.page, '#654321', true); await c.page.clock.fastForward(5000); await expect(c.page.locator('body')).toHaveCSS('background-color', 'rgb(101, 67, 33)'); await expect(a.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await a.page.reload(); await expect(a.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)'); await mode(a.page, 'global'); await expect(a.page.locator('body')).toHaveCSS('background-color', 'rgb(101, 67, 33)'); await mode(a.page, 'local'); await expect(a.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    for (const client of [b, c]) expect(await client.page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.settings-scope.v1')).mode)).toBe('global');
    await a.page.goto('about:blank'); await b.page.goto('about:blank'); await c.page.goto('about:blank'); await env.restart(); await a.page.goto(env.base); await expect(a.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  } finally { await a.close(); await b.close(); await c.close(); await env.close(); }
});

test('Local weather city and photo timing affect only that browser, including independent Local contexts', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const b = await scopeClient(browser, env); const global = await scopeClient(browser, env);
  try {
    await mode(global.page, 'global'); const before = env.store.exportDashboardSettings(); const selected = env.slideshow.snapshot();
    await a.page.route('https://geocoding-api.open-meteo.com/v1/search?*', route => route.fulfill({ json: { results: [{ name: 'Tokyo', latitude: 35, longitude: 139 }] } }));
    await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-weather').click(); await a.page.locator('#location-query').fill('Tokyo'); await a.page.locator('#location-search').getByRole('button', { name: 'Search', exact: true }).click(); await a.page.getByRole('button', { name: 'Tokyo', exact: true }).click(); await expect(a.page.locator('#location-settings-status')).toHaveText('Saved Tokyo for this browser.'); await a.page.locator('#close-settings').click();
    await a.page.clock.fastForward(5000); await expect(a.page.locator('#current-weather-values .temperature')).toHaveText('35 °C'); await expect(global.page.locator('#current-weather-values .temperature')).toHaveText('51 °C'); await expect(b.page.locator('#weather-status')).toContainText('Choose a location');
    await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-images').click(); await a.page.locator('#follow-global-photos').uncheck(); await a.page.locator('[name="order"]').selectOption('name'); await a.page.locator('[name="interval"]').fill('5'); await a.page.locator('[name="imageInfo"]').check(); await a.page.locator('[name="animation"]').selectOption('none'); await a.page.locator('#save-preferences').click(); await a.page.locator('#close-settings').click();
    await expect(a.page.locator('#photo-caption')).toHaveText('0.png'); await a.page.clock.fastForward(5000); await expect(a.page.locator('#photo-caption')).toHaveText('1.png'); await expect(global.page.locator('#photo-caption')).toHaveText(selected.current.name);
    expect(env.store.exportDashboardSettings()).toEqual(before); expect(env.slideshow.snapshot()).toEqual(selected);
    await a.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await a.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await expect(a.page.locator('#settings-scope')).toHaveValue('local'); await expect(a.page.locator('#photo-caption')).toHaveText('1.png');
  } finally { await a.close(); await b.close(); await global.close(); await env.close(); }
});

test('same-profile storage events preserve dirty source drafts and cannot submit Local preferences into Global', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const second = await a.context.newPage(); await second.clock.install(); await second.goto(env.base);
  try {
    await a.page.locator('#open-settings').click(); await a.page.locator('[name="scale"]').fill('1.7');
    await mode(second, 'global'); await expect(a.page.locator('#settings-status')).toContainText('scope changed'); await expect(a.page.locator('[name="scale"]')).toHaveValue('1.7'); await expect(a.page.locator('#save-preferences')).toBeDisabled();
    expect(env.store.getDashboardPreferences().preferences.scale).toBe(1); await a.page.locator('#reload-shared-preferences').click(); await expect(a.page.locator('[name="scale"]')).toHaveValue('1');
  } finally { await a.close(); await env.close(); }
});

test('Local settings persist without the shared endpoint; invalid scope data does not publish Global writes', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    const writes = []; await a.page.route('**/api/dashboard/settings', route => { writes.push(route.request().method()); return route.fulfill({ status: 503, json: { error: 'fixture' } }); });
    await color(a.page, '#123456'); expect(writes).toEqual([]); await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-calendar').click(); await expect(a.page.locator('#connect-calendar')).toBeDisabled();
    await a.page.evaluate(() => { localStorage.setItem('dashboard.settings-scope.v1', '{bad'); }); await a.page.reload(); await expect(a.page.locator('#scope-status')).toContainText('Local'); expect(writes).toEqual([]);
  } finally { await a.close(); await env.close(); }
});

test('Local follows Global by default, persists opt-out, and keeps presentation and other profiles independent', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const b = await scopeClient(browser, env); const global = await scopeClient(browser, env);
  const writes = []; a.page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  try {
    await mode(global.page, 'global'); const before = env.store.exportDashboardSettings();
    const current = () => env.slideshow.snapshot().current.url;
    const image = page => page.locator('#photos .photo-layer > img').last();
    await expect(image(a.page)).toHaveAttribute('src', current()); await expect(image(b.page)).toHaveAttribute('src', current());
    await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-images').click();
    await expect(a.page.locator('#follow-global-photos')).toBeChecked(); await expect(a.page.locator('[name="order"]')).toBeDisabled(); await expect(a.page.locator('[name="interval"]')).toBeDisabled();
    await a.page.locator('#follow-global-photos').uncheck(); await a.page.locator('[name="order"]').selectOption('name'); await a.page.locator('[name="interval"]').fill('5');
    await a.page.locator('[name="opacity"]').fill('0.5'); await a.page.locator('[name="animation"]').selectOption('none');
    await env.clock.advance(60000); await a.page.clock.fastForward(5000); await b.page.clock.fastForward(5000); await global.page.clock.fastForward(5000);
    await expect(image(a.page)).toHaveAttribute('src', current()); await expect(image(b.page)).toHaveAttribute('src', current()); await expect(image(global.page)).toHaveAttribute('src', current());
    await expect(a.page.locator('#follow-global-photos')).not.toBeChecked();
    await a.page.locator('#save-preferences').click(); await a.page.locator('#close-settings').click();
    await expect(a.page.locator('.photo-layer').last()).toHaveCSS('opacity', '0.5');
    await a.page.reload(); await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-images').click();
    await expect(a.page.locator('#follow-global-photos')).not.toBeChecked(); await expect(a.page.locator('[name="interval"]')).toHaveValue('5');
    await a.page.locator('#close-settings').click(); await mode(a.page, 'global'); await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-images').click(); await expect(a.page.locator('#local-photo-controls')).toBeHidden(); await expect(a.page.locator('[name="order"]')).toBeEnabled(); await a.page.locator('#close-settings').click();
    await mode(a.page, 'local'); await expect(a.page.locator('.photo-layer').last()).toHaveCSS('opacity', '0.5');
    await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-images').click(); await expect(a.page.locator('#follow-global-photos')).not.toBeChecked();
    await a.page.locator('#follow-global-photos').check(); await a.page.locator('#save-preferences').click(); await a.page.locator('#close-settings').click();
    await expect(image(a.page)).toHaveAttribute('src', current()); await expect(a.page.locator('.photo-layer').last()).toHaveCSS('opacity', '0.5');
    await a.page.reload(); await mode(a.page, 'global'); await mode(a.page, 'local'); await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-images').click(); await expect(a.page.locator('#follow-global-photos')).toBeChecked();
    await b.page.locator('#open-settings').click(); await b.page.locator('#settings-tab-images').click(); await expect(b.page.locator('#follow-global-photos')).toBeChecked();
    expect(env.store.exportDashboardSettings()).toEqual(before); expect(writes).toEqual([]);
  } finally { await a.close(); await b.close(); await global.close(); await env.close(); }
});

test('same-profile option changes switch playback without overwriting a dirty draft; failed saves retain the choice', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const second = await a.context.newPage(); await second.clock.install(); await second.goto(env.base);
  try {
    const requests = []; a.page.on('request', request => requests.push(new URL(request.url()).pathname));
    await a.page.locator('#open-settings').click(); await a.page.locator('#settings-tab-images').click(); await a.page.locator('[name="opacity"]').fill('0.7');
    await second.locator('#open-settings').click(); await second.locator('#settings-tab-images').click(); await second.locator('#follow-global-photos').uncheck(); await second.locator('#save-preferences').click(); await expect(second.locator('#settings-status')).toHaveText('Preferences saved for this browser.');
    await expect.poll(() => requests.includes('/api/dashboard/photos/local')).toBe(true);
    await expect(a.page.locator('#follow-global-photos')).toBeChecked(); await expect(a.page.locator('[name="opacity"]')).toHaveValue('0.7');
    await a.page.locator('#save-preferences').click(); await expect(a.page.locator('#settings-status')).toContainText('changed');
    await a.page.locator('#reload-shared-preferences').click(); await expect(a.page.locator('#follow-global-photos')).not.toBeChecked();
    await a.page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('quota fixture'); }; });
    await a.page.locator('#follow-global-photos').check(); await a.page.locator('#save-preferences').click(); await expect(a.page.locator('#settings-status')).toHaveText('quota fixture'); await expect(a.page.locator('#follow-global-photos')).toBeChecked();
    expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.local-settings.v1')).followGlobalPhotos)).toBe(false);
    await a.page.locator('#reload-shared-preferences').click(); await expect(a.page.locator('#follow-global-photos')).not.toBeChecked();
  } finally { await a.close(); await env.close(); }
});
