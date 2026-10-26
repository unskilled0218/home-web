import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { initialWidgetProfile } from '../public/dashboard-layout.js';
import { categoryScopes } from '../public/dashboard-settings-categories.js';
import { seedScopes, categoryTab, saveCategory, setCategoryScope } from './category-settings.js';
import { mockSlideshow } from './photo-fixtures.js';

const widgets = [
  { category: 'bookmarks', id: 'bookmarks', key: 'bookmarksScale', mobile: 'mobileBookmarksScale', text: '#bookmark-tree a', descendants: ['#bookmarks h2', '#bookmarks-status', '.bookmark-folder-status', '.bookmark-retry'] },
  { category: 'home-assistant', id: 'dashboard-ha', key: 'homeAssistantScale', mobile: 'mobileHomeAssistantScale', text: '#dashboard-ha-devices ul li', descendants: ['#dashboard-ha h2', '#dashboard-ha-status', '#dashboard-ha-updated', '#dashboard-ha-devices strong'] },
  { category: 'wol', id: 'dashboard-wol', key: 'wolScale', mobile: 'mobileWolScale', text: '#dashboard-wol-devices span', descendants: ['#dashboard-wol h2', '#dashboard-wol-status', '#dashboard-wol-devices button'] }
];
const fonts = page => page.evaluate(selectors => Object.fromEntries(selectors.map(selector => [selector, Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)])), widgets.flatMap(widget => [widget.text, ...widget.descendants]));
const settle = page => page.clock.runFor(100);
const settleViewport = page => page.evaluate(async () => { for (let i = 0; i < 14; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
async function environment(custom = false) {
  const directory = mkdtempSync('/tmp/opencode/widget-scales-'); const filename = `${directory}/app.db`; const secret = Buffer.alloc(32, 9).toString('base64');
  let store; let server; let base; let port = 0; const calls = { devices: 0, bookmarks: 0, wake: 0 };
  const services = {
    homeAssistant: { clearCache() {}, async listDevices() { calls.devices++; return [{ deviceId: 'fixture-sensor', name: 'Fixture sensor', area: 'Office', disabled: false, measurements: [{ entityId: 'sensor.temperature', name: 'Temperature', value: '21', unit: '°C', status: 'available', available: true }] }]; } },
    linkwarden: { clearCache() {}, listCollections: async () => [{ id: 1, name: 'Root', children: [] }], async getBookmarks() { calls.bookmarks++; return { bookmarks: [{ id: 1, name: 'Fixture link', url: 'https://example.test/' }], stale: false }; } },
    wakeExecutor: async () => { calls.wake++; throw new Error('Unexpected Wake'); }
  };
  async function start() {
    store = createStore(filename); server = createDashboardServer({ store, ...services, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret } });
    server.listen(port, '127.0.0.1'); await once(server, 'listening'); port = server.address().port; base = `http://127.0.0.1:${port}`;
  }
  async function stop() { await server.lifecycle.shutdown(); store.close(); }
  await start();
  store.saveHomeAssistant({ baseUrl: 'https://fixture.invalid', encryptedAccessToken: encryptApiKey('fixture-token', secret) });
  store.saveLinkwarden({ baseUrl: 'https://links.invalid', username: 'fixture', encryptedAccessToken: encryptApiKey('fixture-token', secret) });
  store.create({ name: 'Fixture PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: null, group: '' });
  const devices = await (await fetch(`${base}/api/home-assistant/devices?controls=0`)).json(); const collections = await (await fetch(`${base}/api/linkwarden/collections`)).json();
  const catalog = await (await fetch(`${base}/api/bookmarks?collection=${collections.collections[0].collectionToken}`)).json();
  store.saveDashboardPreferences(normalizeDashboardPreferences({ scale: 1.7, imageInfo: true, homeAssistantDeviceSelections: [devices.devices[0].selectionId], bookmarkLinkSelections: [{ selectionId: catalog.bookmarks[0].selectionId, collectionSelectionId: catalog.collectionSelectionId }], ...(custom ? { widgetLayout: { version: 2, desktop: initialWidgetProfile('desktop'), mobile: initialWidgetProfile('mobile') } } : {}) }), 0);
  return { get base() { return base; }, get store() { return store; }, calls, async restart() { await stop(); await start(); }, async close() { await stop(); rmSync(directory, { recursive: true, force: true }); } };
}

async function ready(page, env, mode = 'global') {
  await seedScopes(page.context(), categoryScopes(mode));
  if (mode === 'local') await page.context().addInitScript(preferences => { if (!localStorage.getItem('dashboard.local-settings.v1')) localStorage.setItem('dashboard.local-settings.v1', JSON.stringify({ schema: 1, revision: 3, preferences, weatherLocation: null, followGlobalPhotos: true })); }, env.store.getDashboardPreferences().preferences);
  await page.clock.install();
  await page.addInitScript(() => {
    window.scaleTimers = []; window.scaleClears = []; const original = window.setInterval; const clear = window.clearInterval;
    window.setInterval = (...args) => { const id = original(...args); if (args[1] === 1000) window.scaleTimers.push(id); return id; };
    window.clearInterval = id => { window.scaleClears.push(id); return clear(id); };
  });
  await mockSlideshow(page, [{ name: 'scale-fixture.png', lastModified: 1, url: '/api/dashboard/photos/abcdefghijklmnop' }]);
  await page.route('**/api/dashboard/photos/*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto(env.base); await expect(page.locator('#settings-status')).toContainText(`General settings use ${mode === 'local' ? 'Local' : 'Global'}`);
  await expect(page.locator('#dashboard-ha-devices')).toContainText('Temperature: 21 °C'); await expect(page.locator('#bookmark-tree a')).toHaveText('Fixture link'); await expect(page.locator('#dashboard-wol-devices button')).toBeVisible();
  await expect(page.locator('#photo-caption')).toHaveText('scale-fixture.png');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100)); await settle(page);
}
async function open(page, category) { await page.locator('#open-settings').click(); await categoryTab(page, category); }
const timers = page => page.evaluate(() => ({ created: window.scaleTimers, cleared: window.scaleClears.filter(id => window.scaleTimers.includes(id)) }));
async function retainNodes(page) { await page.evaluate(() => { window.scaleNodes = ['#photos .photo-layer', '#bookmark-tree a', '#dashboard-ha-devices > li', '#dashboard-wol-devices button'].map(selector => [selector, document.querySelector(selector)]); }); }
async function expectNodes(page) { expect(await page.evaluate(() => window.scaleNodes.every(([selector, node]) => document.querySelector(selector) === node))).toBe(true); }

for (const mode of ['local', 'global']) for (const widget of widgets) test(`${mode} ${widget.category} scale saves preserve clock/photo/provider owners and other categories`, async ({ page }) => {
  const env = await environment();
  try {
    await page.setViewportSize({ width: 1200, height: 900 }); await ready(page, env, mode); const baseline = await fonts(page); const globalBefore = env.store.getDashboardPreferences();
    const localBefore = await page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'));
    await open(page, widget.category);
    for (const invalid of ['0.4', '2.1', '1.25']) {
      await page.locator(`[name=${widget.key}]`).fill(invalid); expect(await page.locator(`[name=${widget.key}]`).evaluate(input => input.validity.valid)).toBe(false);
      await page.locator('#save-preferences').click(); expect(env.store.getDashboardPreferences()).toEqual(globalBefore); expect(await page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'))).toBe(localBefore);
    }
    await categoryTab(page, 'time'); await page.locator('[name=timeScale]').fill('1.25'); await categoryTab(page, widget.category);
    await page.locator(`[name=${widget.key}]`).fill('1.8'); await page.locator(`[name=${widget.mobile}]`).fill('0.7');
    expect(await fonts(page)).toEqual(baseline); await page.locator('#close-settings').click(); await open(page, widget.category); await expect(page.locator(`[name=${widget.key}]`)).toHaveValue('1');
    await page.locator(`[name=${widget.key}]`).fill('1.8'); await page.locator(`[name=${widget.mobile}]`).fill('0.7');
    await retainNodes(page); const beforeTimers = await timers(page); const calls = { ...env.calls };
    const settingsFont = await page.locator('#settings-dialog').evaluate(node => getComputedStyle(node).fontSize);
    await saveCategory(page); expect(await timers(page)).toEqual(beforeTimers); expect(env.calls).toEqual(calls); await expectNodes(page);
    expect(await page.locator('#settings-dialog').evaluate(node => getComputedStyle(node).fontSize)).toBe(settingsFont);
    const after = await fonts(page);
    for (const other of widgets) for (const selector of [other.text, ...other.descendants]) expect(after[selector]).toBeCloseTo(baseline[selector] * (other === widget ? 1.8 : 1), 3);
    const raw = mode === 'global' ? env.store.getDashboardPreferences().preferences : await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.local-settings.v1')).preferences);
    expect(raw).toEqual({ ...globalBefore.preferences, [widget.key]: 1.8, [widget.mobile]: .7 });
    if (mode === 'local') expect(env.store.getDashboardPreferences()).toEqual(globalBefore); else expect(await page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'))).toBe(localBefore);
    await page.locator('#close-settings').click(); await page.reload(); await expect(page.locator(widget.text)).toHaveCSS('font-size', `${baseline[widget.text] * 1.8}px`);
    await env.restart(); await page.reload(); await expect(page.locator(widget.text)).toHaveCSS('font-size', `${baseline[widget.text] * 1.8}px`);
    await open(page, widget.category); await setCategoryScope(page, widget.category, mode === 'local' ? 'global' : 'local'); await expect(page.locator(`#${widget.id}`)).toHaveCSS('font-size', '16px');
  } finally { await page.goto('about:blank'); await env.close(); }
});

for (const custom of [false, true]) test(`${custom ? 'Custom' : 'Automatic'} scales select profiles, preserve bounds, and keep editor entry/chrome unchanged`, async ({ page }) => {
  const env = await environment(custom);
  try {
    await page.setViewportSize({ width: 1200, height: 900 }); await ready(page, env); await page.clock.resume(); const baseline = await fonts(page); const layout = env.store.getDashboardPreferences().preferences.widgetLayout;
    const boxes = async () => Object.fromEntries(await Promise.all(widgets.map(async widget => [widget.id, await page.locator(`#${widget.id}`).boundingBox()])));
    const originalBoxes = await boxes(); const current = env.store.getDashboardPreferences(); env.store.saveDashboardPreferences({ ...current.preferences, bookmarksScale: 2, mobileBookmarksScale: .5, homeAssistantScale: .5, mobileHomeAssistantScale: 2, wolScale: 1.6, mobileWolScale: 1.2 }, current.revision);
    await page.clock.fastForward(5000); await expect(page.locator('#bookmarks')).toHaveCSS('font-size', '32px');
    if (custom) expect(await boxes()).toEqual(originalBoxes);
    for (const width of [1200, 900, 601, 600, 390]) {
      await page.setViewportSize({ width, height: 900 }); await settleViewport(page); const mobile = width <= 600;
      const sizes = await fonts(page);
      for (const [i, widget] of widgets.entries()) for (const selector of [widget.text, ...widget.descendants]) expect(sizes[selector]).toBeCloseTo(baseline[selector] * (mobile ? [.5, 2, 1.2] : [2, .5, 1.6])[i], 3);
      for (const widget of widgets) {
        const overflow = await page.locator(`#${widget.id}`).evaluate(node => { const style = getComputedStyle(node); return { width: node.clientWidth, scrollWidth: node.scrollWidth, overflow: style.overflowY }; });
        expect(overflow.width).toBeGreaterThan(0); if (custom) expect(overflow.overflow).toBe('auto');
      }
      const before = await boxes(); await page.locator('#edit-layout').evaluate(node => node.click()); await expect(page.locator('#layout-toolbar')).toBeVisible(); await settleViewport(page);
      expect(await boxes()).toEqual(before); expect(await fonts(page)).toEqual(sizes); await expect(page.locator('#layout-save')).toHaveCSS('font-size', '12px');
      if (!custom) for (const widget of widgets) { const overlay = await page.locator(`[data-widget="${widget.category}"]`).boundingBox(); const box = before[widget.id]; for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(overlay[key] - box[key])).toBeLessThanOrEqual(1); }
      await page.locator('#layout-cancel').click();
    }
    expect(env.store.getDashboardPreferences().preferences.widgetLayout).toEqual(layout);
    await page.evaluate(() => document.documentElement.requestFullscreen()); await settleViewport(page); expect(env.store.getDashboardPreferences().preferences.widgetLayout).toEqual(layout); await page.evaluate(() => document.exitFullscreen());
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('remote scale-only confirmations preserve timer identity while Time and combined updates retain their lifecycle', async ({ page }) => {
  const env = await environment();
  try {
    await ready(page, env); await retainNodes(page); const original = await timers(page); const calls = { ...env.calls };
    for (const widget of widgets) {
      const current = env.store.getDashboardPreferences(); env.store.saveDashboardPreferences({ ...current.preferences, [widget.key]: 1.9 }, current.revision);
      await page.clock.fastForward(5000); await expect(page.locator(`#${widget.id}`)).toHaveCSS('font-size', '30.4px'); expect(await timers(page)).toEqual(original); await expectNodes(page); expect(env.calls).toEqual(calls);
    }
    const time = env.store.getDashboardPreferences(); env.store.saveDashboardPreferences({ ...time.preferences, seconds: !time.preferences.seconds }, time.revision); await page.clock.fastForward(5000);
    await expect.poll(async () => (await timers(page)).created.length).toBe(original.created.length + 1);
    const combined = env.store.getDashboardPreferences(); env.store.saveDashboardPreferences({ ...combined.preferences, seconds: !combined.preferences.seconds, bookmarksScale: .5 }, combined.revision); await page.clock.fastForward(5000);
    await expect(page.locator('#bookmarks')).toHaveCSS('font-size', '8px'); expect((await timers(page)).created.length).toBe(original.created.length + 2); await expectNodes(page);
  } finally { await page.goto('about:blank'); await env.close(); }
});
