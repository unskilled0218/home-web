import { test, expect } from '@playwright/test';
import { settingsEnvironment, scopeClient } from './settings-environment.js';

async function openGlobal(page) { await page.locator('#open-settings').click(); await page.locator('#settings-scope').selectOption('global'); await expect(page.locator('#settings-status')).toHaveText('Preferences are shared across all browsers.'); }
const file = value => ({ name: 'global.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });

test('Global download/upload round trip updates Global peers without changing Local records or mode choices', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const b = await scopeClient(browser, env); const local = await scopeClient(browser, env);
  try {
    await openGlobal(a.page); await openGlobal(b.page); const downloadEvent = a.page.waitForEvent('download'); await a.page.locator('#export-global-settings').click(); const download = await downloadEvent; const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk); const exported = JSON.parse(Buffer.concat(chunks).toString());
    expect(exported).toEqual(env.store.exportDashboardSettings().settings); expect(exported).not.toHaveProperty('mode'); expect(exported).not.toHaveProperty('integrations');
    const imported = { ...exported, preferences: { ...exported.preferences, color: '#123456', timezone: 'Asia/Tokyo' }, weatherLocation: { latitude: 35, longitude: 139, label: 'Tokyo' } };
    await a.page.locator('#global-settings-file').setInputFiles(file(imported)); await expect(a.page.locator('#import-global-settings')).toBeEnabled(); await a.page.locator('#import-global-settings').click(); await expect(a.page.locator('#settings-transfer-status')).toContainText('Global settings imported');
    await b.page.clock.fastForward(5000); await expect(b.page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)'); await expect(local.page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    expect(await local.page.evaluate(() => localStorage.getItem('dashboard.settings-scope.v1'))).toBeNull(); expect(env.store.getWeatherLocation().location.label).toBe('Tokyo');
  } finally { await a.close(); await b.close(); await local.close(); await env.close(); }
});

test('invalid, oversized and stale files preserve settings and drafts; Local import stays disabled', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    await a.page.locator('#open-settings').click(); await expect(a.page.locator('#import-global-settings')).toBeDisabled(); await a.page.locator('#settings-scope').selectOption('global'); await expect(a.page.locator('#settings-status')).toHaveText('Preferences are shared across all browsers.');
    const before = env.store.exportDashboardSettings(); await a.page.locator('#global-settings-file').setInputFiles(file('{bad')); await expect(a.page.locator('#import-global-settings')).toBeDisabled(); expect(env.store.exportDashboardSettings()).toEqual(before);
    await a.page.locator('#global-settings-file').setInputFiles(file('x'.repeat(131073))); await expect(a.page.locator('#settings-transfer-status')).toContainText('128 KiB');
    await a.page.locator('#global-settings-file').setInputFiles(file(before.settings)); await expect(a.page.locator('#import-global-settings')).toBeEnabled();
    env.store.saveDashboardPreferences({ ...before.settings.preferences, color: '#abcdef' }, before.preferencesRevision);
    await a.page.locator('#import-global-settings').click(); await expect(a.page.locator('#settings-transfer-status')).toContainText('changed'); expect(await a.page.locator('#global-settings-file').inputValue()).toContain('global.json'); expect(env.store.getDashboardPreferences().preferences.color).toBe('#abcdef');
    await a.page.locator('[name="scale"]').fill('1.7'); await expect(a.page.locator('#import-global-settings')).toBeDisabled(); await a.page.locator('#settings-scope').selectOption('local'); await expect(a.page.locator('#settings-status')).toContainText('discard'); await expect(a.page.locator('[name="scale"]')).toHaveValue('1.7');
    await a.page.setViewportSize({ width: 390, height: 700 }); await expect(a.page.locator('#close-settings')).toBeInViewport();
  } finally { await a.close(); await env.close(); }
});
