import { test, expect } from '@playwright/test';
import { settingsEnvironment, scopeClient } from './settings-environment.js';
import { CATEGORY_IDS, categoryScopes } from '../public/dashboard-settings-categories.js';
import { categoryTab, saveCategory, setCategoryScope } from './category-settings.js';

const image = page => page.locator('#photos .photo-layer > img').last();
async function open(page, id = 'general') { await page.locator('#open-settings').click(); await categoryTab(page, id); }

test('mixed Time and Weather sources persist independently and category saves preserve other drafts and raw stores', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const b = await scopeClient(browser, env);
  try {
    const before = env.store.getDashboardPreferences(); await open(a.page, 'time'); await setCategoryScope(a.page, 'time', 'global');
    await a.page.locator('[name="timezone"]').fill('Asia/Tokyo'); await saveCategory(a.page);
    await open(b.page, 'time'); await setCategoryScope(b.page, 'time', 'global');
    await b.page.clock.fastForward(5000); await expect(b.page.locator('[name="timezone"]')).toHaveValue('Asia/Tokyo');
    await categoryTab(a.page, 'weather'); await a.page.locator('[name="temperature"]').selectOption('fahrenheit');
    await categoryTab(a.page, 'images'); await a.page.locator('[name="color"]').fill('#123456'); await saveCategory(a.page);
    await categoryTab(a.page, 'weather'); await expect(a.page.locator('[name="temperature"]')).toHaveValue('fahrenheit');
    await a.page.locator('#save-preferences').click(); await expect(a.page.locator('#settings-status')).toContainText('revision changed');
    await a.page.locator('#reload-shared-preferences').click(); await a.page.locator('[name="temperature"]').selectOption('fahrenheit'); await saveCategory(a.page);
    expect(env.store.getDashboardPreferences().preferences.temperature).toBe(before.preferences.temperature); expect(env.store.getDashboardPreferences().preferences.color).toBe(before.preferences.color);
    await categoryTab(a.page, 'time'); await a.page.locator('[name="timezone"]').fill('bad zone');
    await categoryTab(a.page, 'general'); await a.page.locator('[name="scale"]').fill('1.3'); await saveCategory(a.page);
    await categoryTab(a.page, 'time'); await expect(a.page.locator('[name="timezone"]')).toHaveValue('bad zone'); await a.page.locator('#close-settings').click();
    await a.page.reload(); await open(a.page, 'images'); await expect(a.page.locator('[name="color"]')).toHaveValue('#123456'); await expect(a.page.locator('#settings-scope-images')).toHaveValue('local');
    await categoryTab(a.page, 'time'); await expect(a.page.locator('#settings-scope-time')).toHaveValue('global'); await expect(a.page.locator('[name="timezone"]')).toHaveValue('Asia/Tokyo');
  } finally { await a.close(); await b.close(); await env.close(); }
});

for (const legacy of ['local', 'global']) test(`legacy ${legacy} mode seeds all categories without copying values`, async ({ browser }) => {
  const env = await settingsEnvironment(); const context = await browser.newContext(); await context.addInitScript(mode => localStorage.setItem('dashboard.settings-scope.v1', JSON.stringify({ schema: 1, mode })), legacy); const page = await context.newPage();
  try {
    const before = env.store.exportDashboardSettings(); await page.goto(env.base); await open(page);
    for (const id of CATEGORY_IDS) { await categoryTab(page, id); await expect(page.locator(`#settings-scope-${id}`)).toHaveValue(legacy); }
    expect(await page.evaluate(() => localStorage.getItem('dashboard.category-scopes.v1'))).toBeNull(); expect(env.store.exportDashboardSettings()).toEqual(before);
  } finally { await context.close(); await env.close(); }
});

test('scope-only changes preserve photo layers, weather city ownership, and unrelated category drafts', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    await expect(image(a.page)).toBeVisible(); await a.page.evaluate(() => { window.originalPhoto = document.querySelector('#photos .photo-layer'); });
    await open(a.page, 'images'); await a.page.locator('[name="color"]').fill('#123456');
    await setCategoryScope(a.page, 'time', 'global'); await setCategoryScope(a.page, 'weather', 'global');
    await expect(a.page.locator('#current-location')).toContainText('London'); await setCategoryScope(a.page, 'weather', 'local'); await expect(a.page.locator('#current-location')).toHaveText('No weather location saved.');
    await categoryTab(a.page, 'images'); await expect(a.page.locator('[name="color"]')).toHaveValue('#123456');
    expect(await a.page.evaluate(() => window.originalPhoto === document.querySelector('#photos .photo-layer'))).toBe(true);
    await expect(a.page.locator('#follow-global-photos')).toBeChecked(); await expect(a.page.locator('[name="order"]')).toBeDisabled();
    await a.page.locator('#follow-global-photos').uncheck(); await a.page.locator('[name="order"]').selectOption('name'); await a.page.locator('[name="interval"]').fill('5'); await a.page.locator('[name="animation"]').selectOption('none'); await saveCategory(a.page); await a.page.locator('#close-settings').click();
    await expect(image(a.page)).toHaveAttribute('src', env.slideshow.snapshot().current.url); await a.page.clock.fastForward(5000); await expect(image(a.page)).not.toHaveAttribute('src', env.slideshow.snapshot().current.url);
    await a.page.reload(); await open(a.page, 'images'); await expect(a.page.locator('#follow-global-photos')).not.toBeChecked();
    await setCategoryScope(a.page, 'images', 'global'); await expect(a.page.locator('#local-photo-controls')).toBeHidden(); await setCategoryScope(a.page, 'images', 'local'); await expect(a.page.locator('#follow-global-photos')).not.toBeChecked();
  } finally { await a.close(); await env.close(); }
});

test('same-profile scope events retain dirty forms, reject old sources, and leave independent profiles untouched', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env); const other = await scopeClient(browser, env); const second = await a.context.newPage(); await second.clock.install(); await second.goto(env.base);
  try {
    await open(a.page, 'time'); await a.page.locator('[name="timezone"]').fill('Asia/Tokyo'); await open(second, 'time'); await setCategoryScope(second, 'time', 'global');
    await expect(a.page.locator('#settings-status')).toContainText('scope changed'); await expect(a.page.locator('[name="timezone"]')).toHaveValue('Asia/Tokyo'); await expect(a.page.locator('#save-preferences')).toBeDisabled();
    await a.page.locator('#reload-shared-preferences').click(); await expect(a.page.locator('[name="timezone"]')).toHaveValue('UTC');
    await open(other.page, 'time'); await expect(other.page.locator('#settings-scope-time')).toHaveValue('local');
    await categoryTab(a.page, 'weather'); await a.page.locator('[name="temperature"]').selectOption('fahrenheit'); await a.page.evaluate(() => { Storage.prototype.setItem = () => { throw Error('quota fixture'); }; });
    await a.page.locator('#save-preferences').click(); await expect(a.page.locator('#settings-status')).toHaveText('quota fixture'); await expect(a.page.locator('[name="temperature"]')).toHaveValue('fahrenheit');
  } finally { await a.close(); await other.close(); await env.close(); }
});

test('Local categories save offline while Global categories remain unconfirmed and scope controls fit mobile', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    await a.page.route('**/api/dashboard/settings', route => route.fulfill({ status: 503, json: { error: 'offline fixture' } }));
    await open(a.page, 'time'); await a.page.locator('#settings-scope-time').selectOption('global'); await expect(a.page.locator('#save-preferences')).toBeDisabled();
    await categoryTab(a.page, 'weather'); await a.page.locator('[name="temperature"]').selectOption('fahrenheit'); await saveCategory(a.page);
    await a.page.setViewportSize({ width: 390, height: 700 });
    for (const id of CATEGORY_IDS) { await categoryTab(a.page, id); await a.page.locator(`#settings-scope-${id}`).scrollIntoViewIfNeeded(); await expect(a.page.locator(`#settings-scope-${id}`)).toBeInViewport(); }
    await expect(a.page.locator('#close-settings')).toBeInViewport();
  } finally { await a.close(); await env.close(); }
});

test('corrupt scope-map recovery is confirmed, map-only, and keeps dirty drafts stale until reload', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    await open(a.page, 'images'); await a.page.locator('#follow-global-photos').uncheck(); await saveCategory(a.page); const local = await a.page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1')); const before = env.store.exportDashboardSettings();
    await categoryTab(a.page, 'time'); await a.page.locator('[name="timezone"]').fill('Asia/Tokyo'); await a.page.evaluate(() => { localStorage.setItem('dashboard.category-scopes.v1', '{bad'); window.dispatchEvent(new StorageEvent('storage', { key: 'dashboard.category-scopes.v1' })); });
    await categoryTab(a.page, 'general'); await expect(a.page.locator('#category-scope-recovery')).toBeVisible(); a.page.once('dialog', dialog => dialog.dismiss()); await a.page.locator('#reset-category-scopes').click(); expect(await a.page.evaluate(() => localStorage.getItem('dashboard.category-scopes.v1'))).toBe('{bad');
    a.page.once('dialog', dialog => dialog.accept()); await a.page.locator('#reset-category-scopes').click();
    expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.category-scopes.v1')).scopes)).toEqual(categoryScopes()); expect(await a.page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'))).toBe(local); expect(env.store.exportDashboardSettings()).toEqual(before);
    await categoryTab(a.page, 'time'); await expect(a.page.locator('[name="timezone"]')).toHaveValue('Asia/Tokyo'); await expect(a.page.locator('#save-preferences')).toBeDisabled(); await a.page.locator('#reload-shared-preferences').click(); await expect(a.page.locator('#save-preferences')).toBeEnabled();
  } finally { await a.close(); await env.close(); }
});

test('Global Weather with Local Time keeps its city and layout saves preserve raw Global categories', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    await open(a.page, 'time'); await a.page.locator('[name="timezone"]').fill('Asia/Tokyo'); await saveCategory(a.page);
    await setCategoryScope(a.page, 'weather', 'global'); await expect(a.page.locator('#current-location')).toContainText('London');
    await a.page.locator('[name="temperature"]').selectOption('fahrenheit'); await saveCategory(a.page);
    await categoryTab(a.page, 'images'); await a.page.locator('[name="color"]').fill('#123456'); await saveCategory(a.page);
    await setCategoryScope(a.page, 'general', 'global'); await a.page.locator('#close-settings').click();
    await a.page.locator('#edit-layout').click(); await a.page.locator('#layout-toggle').click();
    await a.page.locator('#layout-arrangement').selectOption('custom'); await a.page.locator('#layout-x').fill('20'); await a.page.locator('#layout-x').press('Tab');
    await a.page.locator('#layout-save').click(); await expect(a.page.locator('#layout-toolbar')).toBeHidden();
    const saved = env.store.getDashboardPreferences().preferences;
    expect(saved.timezone).toBe('UTC'); expect(saved.color).toBe('#222222'); expect(saved.temperature).toBe('fahrenheit'); expect(saved.widgetLayout.desktop).not.toBeNull();
    await open(a.page, 'time'); await expect(a.page.locator('[name="timezone"]')).toHaveValue('Asia/Tokyo');
    await categoryTab(a.page, 'weather'); await expect(a.page.locator('#current-location')).toContainText('London');
  } finally { await a.close(); await env.close(); }
});

test('Home Assistant scope changes require explicitly saving or discarding its connection draft', async ({ browser }) => {
  const env = await settingsEnvironment(); const a = await scopeClient(browser, env);
  try {
    await open(a.page, 'home-assistant'); await setCategoryScope(a.page, 'home-assistant', 'global');
    await a.page.locator('#home-assistant-url').fill('https://draft.test'); await a.page.locator('#home-assistant-token').fill('secret draft');
    await a.page.locator('#settings-scope-home-assistant').selectOption('local'); await expect(a.page.locator('#settings-status')).toContainText('discard');
    await expect(a.page.locator('#settings-scope-home-assistant')).toHaveValue('global');
    await a.page.locator('#discard-home-assistant-draft').click(); await expect(a.page.locator('#home-assistant-token')).toHaveValue('');
    await setCategoryScope(a.page, 'home-assistant', 'local');
  } finally { await a.close(); await env.close(); }
});
