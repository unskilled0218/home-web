import { test, expect, firefox } from '@playwright/test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { initialWidgetProfile, defaultWidgetLayout } from '../public/dashboard-layout.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';

async function environment(preferences = {}, services = {}) {
  const directory = mkdtempSync('/tmp/opencode/dashboard-layout-'); const filename = `${directory}/app.db`;
  let store; let server; let base;
  const secret = Buffer.alloc(32, 9).toString('base64');
  async function start() { store = createStore(filename); server = createDashboardServer({ store, ...services, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret, wakeCooldownSeconds: 20 } }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await new Promise(resolve => server.close(resolve)); store.close(); }
  await start(); store.saveDashboardPreferences(normalizeDashboardPreferences(preferences), 0);
  return { secret, get base() { return base; }, get store() { return store; }, async restart() { await stop(); await start(); }, async close() { await stop(); rmSync(directory, { recursive: true, force: true }); } };
}
const layout = () => ({ ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop'), mobile: initialWidgetProfile('mobile') });
async function ready(page, env) { await page.goto(env.base); await expect(page.locator('#settings-status')).toHaveText('Preferences are shared across all browsers.'); }
async function open(page) { await page.locator('#open-settings').click(); await page.locator('#widget-layout-editor').scrollIntoViewIfNeeded(); }
async function save(page) { await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toHaveText('Preferences saved for all browsers.'); }
async function pixel(page, key, value) { await page.locator(`#layout-${key}`).fill(String(value)); await page.locator(`#layout-${key}`).press('Tab'); }
const storedLayout = env => env.store.getDashboardPreferences().preferences.widgetLayout;
async function drag(page, action, id, dx, dy, cancel = false) {
  const button = page.locator(`[data-widget="${id}"] [data-action="${action}"]`);
  await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
  const x = box.x + (action === 'move' ? Math.min(5, box.width / 4) : box.width / 2);
  const y = box.y + (action === 'move' ? Math.min(5, box.height / 4) : box.height / 2);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

test('custom arrangement saves geometry/layers and reset/cancel preserve independent drafts', async ({ page }) => {
  const env = await environment();
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env);
    await expect(page.locator('#widget-surface')).toBeHidden(); await open(page);
    await page.locator('#layout-arrangement').selectOption('custom'); await page.locator('#layout-widget').selectOption('time');
    await pixel(page, 'x', 20); await pixel(page, 'y', 30); await pixel(page, 'w', 210); await pixel(page, 'h', 130);
    await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
    await expect(page.locator('#widget-surface')).toBeHidden();
    await save(page); await page.locator('#close-settings').click();
    await expect(page.locator('#widget-surface')).toBeVisible(); await expect(page.locator('#clock')).toHaveCSS('z-index', '6');
    const first = structuredClone(storedLayout(env)); expect(first.mobile).toBeNull();
    const clock = await page.locator('#clock').boundingBox(); expect(clock.width).toBe(210); expect(clock.height).toBe(130);
    await open(page); await page.getByLabel('Overall scale', { exact: true }).fill('1.2');
    await page.locator('#layout-reset').click(); await page.locator('#layout-cancel').click();
    await expect(page.getByLabel('Overall scale', { exact: true })).toHaveValue('1.2'); await save(page);
    expect(storedLayout(env)).toEqual(first);
    await expect(page.locator('#clock')).toHaveCSS('font-size', '19.2px'); await expect(page.locator('#bookmarks')).toHaveCSS('font-size', '16px');
    await page.locator('#layout-profile').selectOption('mobile'); await page.locator('#layout-arrangement').selectOption('custom'); await save(page);
    expect(storedLayout(env).desktop).toEqual(first.desktop); expect(storedLayout(env).mobile).not.toBeNull();
    await page.locator('#layout-profile').selectOption('desktop'); await page.locator('#layout-reset').click(); await save(page);
    expect(storedLayout(env).desktop).toBeNull(); expect(storedLayout(env).mobile).not.toBeNull();
    await page.locator('#close-settings').click(); await expect(page.locator('#widget-surface')).toBeHidden();
    await env.restart(); await ready(page, env); expect(storedLayout(env).mobile).not.toBeNull();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('covered widgets are selectable and all six share one hit-tested stacking surface', async ({ page }) => {
  const widgetLayout = layout(); widgetLayout.desktop.items = widgetLayout.desktop.items.map(item => ({ ...item, x: 100000, y: 100000, w: 500000, h: 500000 }));
  const env = await environment({ widgetLayout });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env); await open(page);
    for (const id of ['time', 'weather', 'calendar', 'bookmarks', 'home-assistant', 'wol']) {
      await page.locator('#layout-widget').selectOption(id); await page.getByRole('button', { name: 'Bring to front', exact: true }).click(); await save(page); await page.locator('#close-settings').click();
      const top = await page.evaluate(() => { const area = document.getElementById('widget-surface').getBoundingClientRect(); return document.elementFromPoint(area.x + area.width * .2, area.y + area.height * .2)?.closest('#widget-surface > section, #widget-surface > aside')?.id; });
      expect(top).toBe({ time: 'clock', weather: 'weather', calendar: 'calendar', bookmarks: 'bookmarks', 'home-assistant': 'dashboard-ha', wol: 'dashboard-wol' }[id]);
      await expect(page.locator('#open-settings')).toBeVisible(); await open(page);
    }
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('minimum-clamped pointer moves and canceled/no-op edits retain canonical sizes across windows', async ({ browser }) => {
  const widgetLayout = layout(); widgetLayout.desktop.items = widgetLayout.desktop.items.map(item => item.id === 'time' ? { ...item, x: 100000, y: 100000, w: 100000, h: 100000 } : item); widgetLayout.desktop.items.push(widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]);
  const env = await environment({ widgetLayout }); const small = await browser.newPage({ viewport: { width: 832, height: 800 } }); const large = await browser.newPage({ viewport: { width: 1632, height: 1000 } });
  try {
    await ready(small, env); await ready(large, env); await open(small); await small.locator('#layout-widget').selectOption('time');
    const original = structuredClone(storedLayout(env)); const rect = await large.locator('#clock').boundingBox(); expect(rect.width).toBe(160);
    expect((await small.locator('#clock').boundingBox()).width).toBe(100);
    await drag(small, 'move', 'time', 20, 10); await save(small);
    const saved = structuredClone(storedLayout(env)); const item = saved.desktop.items.find(item => item.id === 'time'); expect(item.w).toBe(100000); expect(item.h).toBe(100000);
    expect(saved.desktop.items.filter(item => item.id !== 'time')).toEqual(original.desktop.items.filter(item => item.id !== 'time'));
    await large.reload(); await expect(large.locator('#clock')).toHaveCSS('width', '160px');
    const revision = env.store.getDashboardPreferences().revision;
    await drag(small, 'move', 'time', 15, 15, true); await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    await drag(small, 'move', 'time', 0, 0); await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    const handle = small.locator('[data-widget="time"] [data-action="move"]'); await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox();
    await small.mouse.move(box.x + 4, box.y + 4); await small.mouse.down(); await small.mouse.move(box.x + 14, box.y + 14); await small.mouse.move(box.x + 4, box.y + 4); await small.mouse.up();
    await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    await small.mouse.move(box.x + 4, box.y + 4); await small.mouse.down(); await small.mouse.move(box.x + 14, box.y + 14);
    await handle.dispatchEvent('pointercancel', { pointerId: 1 }); await small.mouse.up(); await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    const x = await small.locator('#layout-x').inputValue(); await pixel(small, 'x', Number(x) + 1); await save(small);
    expect(storedLayout(env).desktop.items.find(item => item.id === 'time').w).toBe(100000);
    expect(storedLayout(env).mobile).toEqual(original.mobile);
  } finally { await small.close(); await large.close(); await env.close(); }
});

test('custom cards stay within each viewport without resize writes, including tiny surfaces and all-hidden editing', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() });
  try {
    await ready(page, env); const original = env.store.getDashboardPreferences(); let writes = 0;
    page.on('request', request => { if (request.url().endsWith('/api/dashboard/settings') && request.method() === 'PUT') writes++; });
    for (const [width, height] of [[320, 480], [600, 300], [601, 800], [1000, 500], [1200, 800], [160, 150]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => { const stage = document.getElementById('widget-surface'); const area = stage.getBoundingClientRect(); if (stage.hidden) return area.width === 0 && area.height === 0; return [...document.querySelectorAll('#widget-surface > section, #widget-surface > aside')].every(node => { const box = node.getBoundingClientRect(); return box.width >= Math.min(100, area.width) && box.height >= Math.min(100, area.height) && box.x >= area.x && box.y >= area.y && box.right <= area.right && box.bottom <= area.bottom; }); })).toBe(true);
    }
    expect(writes).toBe(0); expect(env.store.getDashboardPreferences()).toEqual(original);
    await page.setViewportSize({ width: 1200, height: 800 }); await open(page);
    for (const name of ['time', 'weather', 'calendar', 'bookmarks', 'homeAssistant', 'wol']) await page.locator(`[name="${name}Visible"]`).uncheck();
    await save(page); await page.locator('#close-settings').click(); await expect(page.locator('#widget-surface')).toBeHidden();
    await open(page); await expect(page.locator('#layout-w')).toBeEnabled(); await expect(page.locator('#layout-preview')).toBeVisible();
    await page.locator('#close-settings').click(); await page.locator('#fullscreen').click(); await expect(page.locator('#open-settings')).toBeVisible(); await page.locator('#fullscreen').click();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('remote layout conflicts preserve dirty geometry and credentials; offline writes never change live layout', async ({ browser }) => {
  const env = await environment({ widgetLayout: layout() }); const a = await browser.newPage(); const b = await browser.newPage();
  try {
    await b.clock.install(); await ready(a, env); await ready(b, env); await open(a); await open(b);
    await pixel(b, 'w', 170); await b.locator('#settings-tab-home-assistant').click(); await b.locator('#home-assistant-url').fill('https://unsaved.test'); await b.locator('#settings-tab-general').click();
    await pixel(a, 'w', 240); await save(a); await b.clock.fastForward(5000);
    await expect(b.locator('#layout-w')).toHaveValue('170');
    await b.locator('#save-preferences').click(); await expect(b.locator('#settings-status')).toContainText('changed in another browser');
    await expect(b.locator('#layout-w')).toHaveValue('170');
    await b.locator('#reload-shared-preferences').click(); await expect(b.locator('#layout-w')).toHaveValue('240');
    await b.locator('#settings-tab-home-assistant').click(); await expect(b.locator('#home-assistant-url')).toHaveValue('https://unsaved.test'); await b.locator('#settings-tab-general').click();
    const saved = structuredClone(storedLayout(env));
    await b.route('**/api/dashboard/settings', route => route.request().method() === 'PUT' ? route.abort() : route.continue());
    await pixel(b, 'w', 200); await b.locator('#save-preferences').click(); await expect(b.locator('#settings-status')).not.toHaveText('Preferences saved for all browsers.');
    await expect(b.locator('#layout-w')).toHaveValue('200'); expect(storedLayout(env)).toEqual(saved);
    await b.locator('#settings-tab-time').click(); await b.getByLabel('Timezone', { exact: true }).fill('Invalid/Zone'); await b.locator('#settings-tab-general').click(); await b.locator('#layout-cancel').click();
    await pixel(a, 'w', 250); await save(a); await b.clock.fastForward(5000);
    await expect(b.getByLabel('Timezone', { exact: true })).toHaveValue('Invalid/Zone'); await expect(b.locator('#layout-w')).toHaveValue('240');
    await b.locator('#close-settings').click(); await open(b); await expect(b.locator('#layout-w')).toHaveValue('250');
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('real resize gestures and keyboard fields edit only intended dimensions', async ({ page }) => {
  const widgetLayout = layout(); const time = widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]; time.y = 100000; time.h = 200000; widgetLayout.desktop.items.push(time);
  const env = await environment({ widgetLayout });
  try {
    await ready(page, env); await open(page); await page.locator('#layout-widget').selectOption('time');
    const original = structuredClone(storedLayout(env));
    await drag(page, 'resize', 'time', 10, 8); await save(page);
    const item = storedLayout(env).desktop.items.at(-1); expect(item.w).not.toBe(time.w); expect(item.h).not.toBe(time.h);
    expect(item.x).toBe(time.x); expect(item.y).toBe(time.y);
    await page.locator('#layout-w').focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab'); await save(page);
    const resized = storedLayout(env).desktop.items.at(-1); expect(resized.h).toBe(item.h); expect(resized.w).toBeGreaterThan(item.w);
    expect(storedLayout(env).desktop.items.slice(0, -1)).toEqual(original.desktop.items.slice(0, -1));
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('touch preview gestures capture only editing affordances and cancel on viewport changes', async ({ browser }) => {
  const widgetLayout = layout(); const time = widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]; widgetLayout.desktop.items.push(time);
  const env = await environment({ widgetLayout }); const context = await browser.newContext({ hasTouch: true, viewport: { width: 1100, height: 800 } }); const page = await context.newPage();
  try {
    await ready(page, env); await open(page); await page.locator('#layout-widget').selectOption('time');
    const session = await context.newCDPSession(page); const handle = page.locator('[data-widget="time"] [data-action="move"]'); await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 15, y: point.y + 10 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await save(page);
    const saved = structuredClone(storedLayout(env)); expect(saved.desktop.items.at(-1).x).not.toBe(time.x); expect(saved.desktop.items.at(-1).w).toBe(time.w);
    const next = await handle.boundingBox(); const point2 = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point2] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point2.x + 10, y: point2.y + 10 }] });
    await page.locator('#layout-preview').dispatchEvent('pointercancel', { pointerId: 9999 }); await expect(page.locator('#layout-w')).toBeDisabled();
    await page.setViewportSize({ width: 1000, height: 800 }); await expect(page.locator('#layout-preview')).toHaveAttribute('data-width', '968'); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await save(page);
    expect(storedLayout(env)).toEqual(saved);
  } finally { await context.close(); await env.close(); }
});

test('100px cards retain scroll access and fullscreen fitting without changing saved geometry', async ({ page }) => {
  const widgetLayout = layout(); widgetLayout.desktop.items = widgetLayout.desktop.items.map(item => ({ ...item, w: 1, h: 1 }));
  const env = await environment({ widgetLayout });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env);
    for (const id of ['clock', 'weather', 'calendar', 'bookmarks', 'dashboard-ha', 'dashboard-wol']) {
      const box = await page.locator(`#${id}`).boundingBox(); expect(box.width).toBe(100); expect(box.height).toBe(100);
      await page.locator(`#${id}`).evaluate(node => { const content = document.createElement('p'); content.textContent = 'Long readable content '.repeat(80); const button = document.createElement('button'); button.textContent = 'Last content action'; node.append(content, button); });
      await page.locator(`#${id}`).getByRole('button', { name: 'Last content action' }).scrollIntoViewIfNeeded();
      expect(await page.locator(`#${id}`).evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    }
    await open(page); await page.locator('#layout-widget').selectOption('time');
    await pixel(page, 'w', Number(await page.locator('#layout-preview').getAttribute('data-width'))); await pixel(page, 'h', Number(await page.locator('#layout-preview').getAttribute('data-height'))); await save(page); await page.locator('#close-settings').click();
    const area = await page.locator('#widget-surface').boundingBox(); const max = await page.locator('#clock').boundingBox(); expect(max).toEqual(area);
    const before = env.store.getDashboardPreferences(); await page.locator('#fullscreen').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.evaluate(() => document.exitFullscreen()); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    expect(env.store.getDashboardPreferences()).toEqual(before);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('layout-only changes and caption callbacks retain clock/slideshow owners', async ({ page }) => {
  const env = await environment({ widgetLayout: layout(), imageInfo: true, interval: 5, order: 'name', animation: 'none' }); let manifests = 0;
  try {
    await page.clock.install(); await page.addInitScript(() => { window.layoutClockCalls = []; const original = window.setInterval; window.setInterval = (...args) => { const id = original(...args); window.layoutClockCalls.push({ id, delay: args[1] }); return id; }; });
    await page.route('**/api/dashboard/photos', route => { manifests++; return route.fulfill({ json: { available: true, photos: [{ name: 'first.png', lastModified: 1, url: '/api/dashboard/photos/abcdefghijklmnop' }, { name: 'second.png', lastModified: 2, url: '/api/dashboard/photos/qrstuvwxyzabcdef' }] } }); });
    await page.route('**/api/dashboard/photos/*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
    await ready(page, env); await expect(page.locator('#photo-caption')).toHaveText('first.png');
    const timers = await page.evaluate(() => window.layoutClockCalls); await open(page); await pixel(page, 'w', 180); await save(page); await page.locator('#close-settings').click();
    expect(await page.evaluate(() => window.layoutClockCalls)).toEqual(timers);
    const revision = env.store.getDashboardPreferences().revision;
    for (const caption of ['second.png', 'first.png', 'second.png']) { await page.clock.fastForward(5000); await expect(page.locator('#photo-caption')).toHaveText(caption); expect(await page.evaluate(() => window.layoutClockCalls)).toEqual(timers); expect(manifests).toBe(1); expect(env.store.getDashboardPreferences().revision).toBe(revision); }
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('Firefox and Chromium share canonical layouts but fit their own viewport', async ({ browser }) => {
  const env = await environment(); const other = await firefox.launch(); const a = await browser.newPage({ viewport: { width: 1200, height: 800 } }); const b = await other.newPage({ viewport: { width: 800, height: 700 } });
  try {
    await b.clock.install(); await ready(a, env); await ready(b, env); await open(a); await a.locator('#layout-arrangement').selectOption('custom'); await save(a);
    await b.clock.fastForward(5000); await expect(b.locator('#widget-surface')).toBeVisible();
    const cache = await b.evaluate(() => JSON.parse(localStorage.getItem('dashboard.shared-settings.v1'))); expect(cache.preferences.widgetLayout).toEqual(storedLayout(env));
    expect((await b.locator('#widget-surface').boundingBox()).width).toBeLessThan((await a.locator('#widget-surface').boundingBox()).width);
  } finally { await a.close(); await other.close(); await env.close(); }
});

test('custom/automatic transitions preserve a pending stubbed Wake, selected readings, and safe new-tab bookmarks', async ({ page }) => {
  let sent = 0; let releaseWake; let url; let deviceReads = 0; let bookmarkReads = 0;
  const services = {
    homeAssistant: { clearCache() {}, async listDevices() { deviceReads++; return [{ deviceId: 'fixture-sensor', name: 'Fixture sensor', area: 'Office', disabled: false, measurements: [{ entityId: 'sensor.temperature', name: 'Temperature', value: '21', unit: '°C', status: 'available', available: true }] }]; } },
    linkwarden: { clearCache() {}, listCollections: async () => [{ id: 1, name: 'Root', children: [] }], async getBookmarks() { bookmarkReads++; return { bookmarks: [{ id: 1, name: 'Fixture link', url: `${url}/api/health` }], stale: false }; } },
    wakeExecutor: async ({ markWake, audit }) => { sent++; await new Promise(resolve => { releaseWake = resolve; }); markWake(); audit('sent', 'fixture'); return { sent: true, dispatch: { sent: 1, attempted: 1 } }; }
  };
  const env = await environment({ widgetLayout: layout() }, services); url = env.base;
  try {
    env.store.saveHomeAssistant({ baseUrl: 'https://fixture.invalid', encryptedAccessToken: encryptApiKey('fixture-token', env.secret) });
    env.store.saveLinkwarden({ baseUrl: 'https://links.invalid', username: 'fixture', encryptedAccessToken: encryptApiKey('fixture-token', env.secret) });
    env.store.create({ name: 'Fixture PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: null, group: '' });
    const devices = await (await fetch(`${env.base}/api/home-assistant/devices?controls=0`)).json();
    const collections = await (await fetch(`${env.base}/api/linkwarden/collections`)).json();
    const catalog = await (await fetch(`${env.base}/api/bookmarks?collection=${collections.collections[0].collectionToken}`)).json();
    const current = env.store.getDashboardPreferences();
    env.store.saveDashboardPreferences({ ...current.preferences, homeAssistantDeviceSelections: [devices.devices[0].selectionId], bookmarkLinkSelections: [{ selectionId: catalog.bookmarks[0].selectionId, collectionSelectionId: catalog.collectionSelectionId }] }, current.revision);
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env);
    await expect(page.locator('#dashboard-ha-devices')).toContainText('Temperature: 21 °C');
    const link = page.getByRole('link', { name: 'Fixture link', exact: true }); await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', /noopener/);
    const popup = page.waitForEvent('popup'); await link.click(); const opened = await popup; await opened.waitForURL(`${env.base}/api/health`); await opened.close();
    const button = page.getByRole('button', { name: 'Wake Fixture PC', exact: true }); await button.click(); await expect.poll(() => sent).toBe(1); await expect(button).toBeDisabled();
    await page.evaluate(() => { window.pendingLayoutWake = document.querySelector('#dashboard-wol-devices button'); window.layoutSensor = document.querySelector('#dashboard-ha-devices > li'); });
    const reads = { devices: deviceReads, bookmarks: bookmarkReads };
    await open(page); await page.locator('#layout-arrangement').selectOption('automatic'); await save(page);
    await page.locator('#layout-arrangement').selectOption('custom'); await save(page); await page.locator('#close-settings').click();
    expect(await page.evaluate(() => window.pendingLayoutWake === document.querySelector('#dashboard-wol-devices button') && window.layoutSensor === document.querySelector('#dashboard-ha-devices > li'))).toBe(true);
    await expect(button).toBeDisabled(); expect(sent).toBe(1); expect({ devices: deviceReads, bookmarks: bookmarkReads }).toEqual(reads);
    releaseWake(); await expect(button).toBeEnabled(); await expect(page.locator('#dashboard-wol-action-status')).toContainText('does not confirm'); expect(sent).toBe(1);
  } finally { releaseWake?.(); await page.goto('about:blank'); await env.close(); }
});

test('confirmed cached layouts remain usable offline without becoming writable server authority', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() });
  try {
    await ready(page, env); const saved = env.store.getDashboardPreferences();
    await page.route('**/api/dashboard/settings', route => route.abort()); await page.reload();
    await expect(page.locator('#widget-surface')).toBeVisible(); await expect(page.locator('#settings-status')).not.toHaveText('Loading shared preferences…');
    await open(page); await expect(page.locator('#save-preferences')).toBeDisabled(); await expect(page.locator('#layout-arrangement')).toHaveValue('custom');
    expect(env.store.getDashboardPreferences()).toEqual(saved);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.shared-settings.v1')).preferences.widgetLayout)).toEqual(saved.preferences.widgetLayout);
  } finally { await page.goto('about:blank'); await env.close(); }
});
