import { test, expect } from '@playwright/test';
import { settingsEnvironment, scopeClient } from './settings-environment.js';
import { setCategoryScope, saveCategory } from './category-settings.js';

async function openTransfer(page) { await page.locator('#open-settings').click(); await expect(page.locator('#settings-scope-general')).toHaveCount(0); }
const file = value => ({ name: 'global.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });

test('Global download/upload round trip updates Global peers without changing Local records or mode choices', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const b = await scopeClient(browser, env); const local = await scopeClient(browser, env);
  try {
    await local.page.locator('#open-settings').click(); await local.page.locator('#settings-tab-images').click(); await local.page.locator('[name="opacity"]').fill('0.5'); await local.page.locator('[name="animation"]').selectOption('none'); await saveCategory(local.page); await local.page.locator('#close-settings').click();
    const localRecord = await local.page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'));
    await openTransfer(a.page); await openTransfer(b.page); await setCategoryScope(b.page, 'images', 'global'); await b.page.locator('#settings-tab-general').click(); const downloadEvent = a.page.waitForEvent('download'); await a.page.locator('#export-global-settings').click(); const download = await downloadEvent; const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk); const exported = JSON.parse(Buffer.concat(chunks).toString());
    expect(exported).toEqual(env.store.exportDashboardSettings().settings); expect(exported).not.toHaveProperty('mode'); expect(exported).not.toHaveProperty('integrations');
    const imported = { ...exported, preferences: { ...exported.preferences, color: '#123456', timezone: 'Asia/Tokyo', order: 'date', interval: 5 }, weatherLocation: { latitude: 35, longitude: 139, label: 'Tokyo' } };
    await a.page.locator('#global-settings-file').setInputFiles(file(imported)); await expect(a.page.locator('#import-global-settings')).toBeEnabled(); await a.page.locator('#import-global-settings').click(); await expect(a.page.locator('#settings-transfer-status')).toContainText('Global settings imported');
    await b.page.clock.fastForward(5000); await expect(b.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)'); await expect(local.page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    expect(await local.page.evaluate(() => localStorage.getItem('dashboard.settings-scope.v1'))).toBeNull(); expect(env.store.getWeatherLocation().location.label).toBe('Tokyo');
    await expect(a.page.locator('#settings-transfer-status')).toHaveText('Global settings imported. Local preferences and category choices were not changed. Local followers continue tracking the shared slideshow.');
    await env.clock.advance(5000); await local.page.clock.fastForward(5000); await b.page.clock.fastForward(5000);
    const selected = env.slideshow.snapshot().current.url;
    await expect(local.page.locator('#photos .photo-layer > img').last()).toHaveAttribute('src', selected); await expect(b.page.locator('#photos .photo-layer > img').last()).toHaveAttribute('src', selected);
    expect(await local.page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'))).toBe(localRecord); expect(JSON.parse(localRecord).followGlobalPhotos).toBe(true); await expect(local.page.locator('.photo-layer').last()).toHaveCSS('opacity', '0.5');
  } finally { await a.close(); await b.close(); await local.close(); await env.close(); }
});

test('invalid, oversized and stale files preserve settings and drafts without a General selector', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    await openTransfer(a.page); await expect(a.page.locator('#import-global-settings')).toBeDisabled();
    const before = env.store.exportDashboardSettings(); await a.page.locator('#global-settings-file').setInputFiles(file('{bad')); await expect(a.page.locator('#import-global-settings')).toBeDisabled(); expect(env.store.exportDashboardSettings()).toEqual(before);
    await a.page.locator('#global-settings-file').setInputFiles(file('x'.repeat(131073))); await expect(a.page.locator('#settings-transfer-status')).toContainText('128 KiB');
    await a.page.locator('#global-settings-file').setInputFiles(file(before.settings)); await expect(a.page.locator('#import-global-settings')).toBeEnabled();
    env.store.saveDashboardPreferences({ ...before.settings.preferences, color: '#abcdef' }, before.preferencesRevision);
    await a.page.locator('#import-global-settings').click(); await expect(a.page.locator('#settings-transfer-status')).toContainText('changed'); expect(await a.page.locator('#global-settings-file').inputValue()).toContain('global.json'); expect(env.store.getDashboardPreferences().preferences.color).toBe('#abcdef');
    await a.page.locator('#settings-tab-time').click(); await a.page.locator('[name="timeScale"]').fill('1.7'); await a.page.locator('#settings-tab-general').click(); await expect(a.page.locator('#import-global-settings')).toBeDisabled();
    await a.page.locator('#settings-tab-time').click(); await a.page.locator('#settings-scope-time').selectOption('global'); await expect(a.page.locator('#settings-status')).toContainText('discard'); await expect(a.page.locator('[name="timeScale"]')).toHaveValue('1.7');
    await a.page.locator('#settings-tab-general').click(); await expect(a.page.locator('#settings-scope-general')).toHaveCount(0);
    await a.page.setViewportSize({ width: 390, height: 700 }); await expect(a.page.locator('#close-settings')).toBeInViewport();
  } finally { await a.close(); await env.close(); }
});

test('all-Local transfer retries preparation and weather conflicts without changing ownership or starting Global polling', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); let offline = true; let reads = 0;
  try {
    await a.page.route('**/api/dashboard/settings', async route => { reads++; if (offline) await route.fulfill({ status: 503, json: { error: 'offline preparation fixture' } }); else await route.continue(); });
    await openTransfer(a.page); await a.page.setViewportSize({ width: 390, height: 700 }); await expect(a.page.locator('#global-settings-file')).toBeVisible();
    const raw = await a.page.evaluate(() => [localStorage.getItem('dashboard.local-settings.v1'), localStorage.getItem('dashboard.category-scopes.v1')]);
    const before = env.store.exportDashboardSettings(); expect(reads).toBe(0);
    await a.page.locator('#global-settings-file').setInputFiles(file(before.settings)); await expect(a.page.locator('#settings-transfer-status')).toContainText('offline preparation fixture');
    await expect(a.page.locator('#import-global-settings')).toBeDisabled(); await expect(a.page.locator('#global-settings-file')).not.toHaveValue('');
    await a.page.clock.fastForward(15000); expect(reads).toBe(1); expect(env.store.exportDashboardSettings()).toEqual(before);
    offline = false; await a.page.locator('#reload-shared-preferences').click(); await expect(a.page.locator('#import-global-settings')).toBeEnabled(); expect(reads).toBe(2);
    const location = env.store.getWeatherLocation(); env.store.saveWeatherLocation({ latitude: 35, longitude: 139, label: 'Tokyo' }, location.revision);
    await a.page.locator('#import-global-settings').click(); await expect(a.page.locator('#settings-transfer-status')).toContainText('changed'); await expect(a.page.locator('#global-settings-file')).not.toHaveValue('');
    expect(env.store.getDashboardPreferences().revision).toBe(before.preferencesRevision); expect(env.store.getWeatherLocation().location.label).toBe('Tokyo');
    await a.page.locator('#reload-shared-preferences').click(); await expect(a.page.locator('#import-global-settings')).toBeEnabled(); expect(reads).toBe(3);
    await a.page.locator('#import-global-settings').click(); await expect(a.page.locator('#settings-transfer-status')).toContainText('Global settings imported');
    expect(env.store.getWeatherLocation().location.label).toBe('London');
    expect(await a.page.evaluate(() => [localStorage.getItem('dashboard.local-settings.v1'), localStorage.getItem('dashboard.category-scopes.v1')])).toEqual(raw);
    await a.page.clock.fastForward(15000); expect(reads).toBe(3); await expect(a.page.locator('#settings-scope-general')).toHaveCount(0);
    await expect(a.page.locator('#close-settings')).toBeInViewport();
  } finally { await a.close(); await env.close(); }
});
