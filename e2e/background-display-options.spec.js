import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';

const sections = { time: 'clock', weather: 'weather', calendar: 'calendar', bookmarks: 'bookmarks', homeAssistant: 'dashboard-ha', wol: 'dashboard-wol' };
const field = (name, mobile) => `${mobile ? `mobile${name[0].toUpperCase()}${name.slice(1)}` : name}Visible`;
const hidden = Object.fromEntries(Object.keys(sections).flatMap((name) => [[field(name, false), false], [field(name, true), false]]));
async function environment() {
  const directory = mkdtempSync('/tmp/opencode/background-display-'); const filename = `${directory}/app.db`;
  let store; let server; let base;
  async function start() {
    store = createStore(filename); server = createDashboardServer({ store, runtimeConfig: { allowedHosts: ['127.0.0.1'] } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise((resolve) => server.close(resolve)); store.close(); }
  await start();
  return { get base() { return base; }, get store() { return store; }, async restart() { await stop(); await start(); }, async close() { await stop(); rmSync(directory, { recursive: true, force: true }); } };
}
async function ready(page, env) { await page.goto(env.base); await expect(page.locator('#settings-status')).toHaveText('Preferences are shared across all browsers.'); }
async function save(page) { await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toHaveText('Preferences saved for all browsers.'); }
async function setFlags(page, flags) {
  await page.locator('#open-settings').click();
  for (const [name, value] of Object.entries(flags)) await page.locator(`[name="${name}"]`).setChecked(value);
  await save(page); await page.locator('#close-settings').click();
}

test('each checkbox affects only its profile after save, preserves choices, and survives restart', async ({ page }) => {
  const env = await environment();
  try {
    env.store.saveDashboardPreferences(normalizeDashboardPreferences({ bookmarkLinkSelections: [], homeAssistantDeviceSelections: ['d_' + 'a'.repeat(43)] }), 0);
    await ready(page, env);
    for (const mobile of [false, true]) {
      await page.setViewportSize({ width: mobile ? 390 : 1200, height: 800 });
      for (const [name, id] of Object.entries(sections)) {
        await page.locator('#open-settings').click();
        await page.locator(`[name="${field(name, mobile)}"]`).uncheck();
        await expect(page.locator(`#${id}`)).toBeVisible();
        await save(page); await page.locator('#close-settings').click(); await expect(page.locator(`#${id}`)).toBeHidden();
        for (const other of Object.values(sections).filter((value) => value !== id)) await expect(page.locator(`#${other}`)).toBeVisible();
        await page.setViewportSize({ width: mobile ? 1200 : 390, height: 800 }); await expect(page.locator(`#${id}`)).toBeVisible();
        await page.setViewportSize({ width: mobile ? 390 : 1200, height: 800 });
        await setFlags(page, { [field(name, mobile)]: true });
      }
    }
    await setFlags(page, hidden); const saved = env.store.getDashboardPreferences().preferences;
    expect(saved.bookmarkLinkSelections).toEqual([]); expect(saved.homeAssistantDeviceSelections).toEqual(['d_' + 'a'.repeat(43)]);
    await page.reload(); await expect(page.locator('#dashboard-content')).toBeHidden();
    await env.restart(); await ready(page, env); expect(env.store.getDashboardPreferences().preferences).toEqual(saved); await expect(page.locator('#dashboard-content')).toBeHidden();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('mixed layouts collapse absent groups at profile and stacking boundaries', async ({ page }) => {
  const env = await environment();
  try {
    await ready(page, env);
    for (const enabled of [[], ['time'], ['homeAssistant'], ['wol'], ['homeAssistant', 'wol'], ['bookmarks'], ['time', 'bookmarks'], ['homeAssistant', 'bookmarks']]) {
      const flags = { ...hidden }; for (const name of enabled) { flags[field(name, false)] = true; flags[field(name, true)] = true; }
      await setFlags(page, flags);
      for (const width of [1200, 900, 601, 600, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1200 ? 420 : 800 });
        const geometry = await page.evaluate(() => {
          const content = document.getElementById('dashboard-content'); const devices = document.getElementById('dashboard-devices');
          const visible = [...content.children].filter((node) => !node.hidden);
          const boxes = visible.map((node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width }; });
          return { columns: getComputedStyle(content).gridTemplateColumns.split(' ').length, rows: getComputedStyle(devices).gridTemplateRows.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth, content: !content.hidden, groups: visible.length, boxes };
        });
        expect(geometry.overflow).toBe(false); expect(geometry.content).toBe(enabled.length > 0);
        for (const box of geometry.boxes) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); expect(box.width).toBeGreaterThan(0); }
        for (let index = 1; index < geometry.boxes.length; index++) {
          if (width > 1000) expect(geometry.boxes[index].left).toBeGreaterThanOrEqual(geometry.boxes[index - 1].right);
          else expect(geometry.boxes[index].top).toBeGreaterThanOrEqual(geometry.boxes[index - 1].bottom);
        }
        if (width > 1000 && enabled.length) { expect(geometry.columns).toBe(geometry.groups); if (enabled.includes('homeAssistant') || enabled.includes('wol')) expect(geometry.rows).toBe(enabled.includes('homeAssistant') && enabled.includes('wol') ? 2 : 1); }
        await expect(page.locator('#open-settings')).toBeVisible();
      }
      await page.locator('#open-settings').click(); await expect(page.locator('#save-preferences')).toBeInViewport(); await expect(page.locator('#close-settings')).toBeInViewport(); await page.locator('#close-settings').click();
    }
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('remote visibility retains dirty revisions, rejects stale save, and reload preserves credential drafts', async ({ browser }) => {
  const env = await environment(); const a = await browser.newPage(); const b = await browser.newPage();
  try {
    await b.clock.install(); await ready(a, env); await ready(b, env);
    await b.locator('#open-settings').click(); await b.locator('[name="wolVisible"]').uncheck();
    await b.locator('#settings-tab-home-assistant').click(); await b.locator('#home-assistant-url').fill('http://draft.test'); await b.locator('#settings-tab-general').click();
    await setFlags(a, { homeAssistantVisible: false, bookmarksVisible: false });
    await b.clock.fastForward(5000); await expect(b.locator('#dashboard-ha')).toBeHidden(); await expect(b.locator('#bookmarks')).toBeHidden(); await expect(b.locator('[name="homeAssistantVisible"]')).toBeChecked();
    await b.locator('#save-preferences').click(); await expect(b.locator('#settings-status')).toContainText('changed in another browser'); expect(env.store.getDashboardPreferences().preferences.wolVisible).toBe(true);
    await b.locator('#reload-shared-preferences').click(); await expect(b.locator('[name="homeAssistantVisible"]')).not.toBeChecked();
    await b.locator('#settings-tab-home-assistant').click(); await expect(b.locator('#home-assistant-url')).toHaveValue('http://draft.test');
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('background-only fullscreen tools remain reachable and exit never restores disabled bookmarks', async ({ page }) => {
  const env = await environment();
  try {
    await ready(page, env); await setFlags(page, { ...hidden, bookmarksVisible: true });
    await page.locator('#open-settings').click(); await page.locator('#settings-tab-bookmarks').click(); await page.locator('[name="hideBookmarksFullscreen"]').check(); await save(page); await page.locator('#close-settings').click();
    await page.locator('#fullscreen').click(); await expect(page.locator('#fullscreen')).toHaveText('Exit fullscreen'); await expect(page.locator('#bookmarks')).toBeHidden(); await expect(page.locator('#open-settings')).toBeVisible();
    await setFlags(page, { bookmarksVisible: false }); await page.locator('#fullscreen').click(); await expect(page.locator('#bookmarks')).toBeHidden();
    await page.locator('#fullscreen').click(); await expect(page.locator('#open-settings')).toBeVisible(); await expect(page.locator('#fullscreen')).toBeVisible(); await page.locator('#fullscreen').click();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('slideshow captions update geometry without resetting clock timers or adding request owners', async ({ page }) => {
  const env = await environment(); let manifests = 0; let folders = 0;
  try {
    env.store.saveDashboardPreferences(normalizeDashboardPreferences({ ...hidden, timeVisible: true, imageInfo: true, interval: 5, animation: 'none', order: 'name' }), 0);
    await page.clock.install();
    await page.addInitScript(() => {
      window.clockIntervalCalls = []; const original = window.setInterval;
      window.setInterval = (...args) => { const id = original(...args); window.clockIntervalCalls.push({ id, delay: args[1], start: Date.now() }); return id; };
    });
    await page.route('**/api/dashboard/photos', (route) => { manifests++; return route.fulfill({ json: { available: true, photos: [{ name: 'first.png', lastModified: 1, url: '/api/dashboard/photos/abcdefghijklmnop' }, { name: 'second.png', lastModified: 2, url: '/api/dashboard/photos/qrstuvwxyzabcdef' }] } }); });
    await page.route('**/api/dashboard/photos/*', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
    page.on('request', (request) => { if (/api\/linkwarden\/.*bookmarks/.test(request.url())) folders++; });
    await ready(page, env); await expect(page.locator('#photo-caption')).toHaveText('first.png');
    const timers = await page.evaluate(() => window.clockIntervalCalls); const revision = env.store.getDashboardPreferences().revision;
    for (const caption of ['second.png', 'first.png', 'second.png']) {
      await page.clock.fastForward(5000); await expect(page.locator('#photo-caption')).toHaveText(caption);
      expect(await page.evaluate(() => window.clockIntervalCalls)).toEqual(timers); expect(manifests).toBe(1); expect(folders).toBe(0); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    }
    await setFlags(page, { timeVisible: false }); await expect(page.locator('#information')).toBeVisible(); await expect(page.locator('body')).toHaveClass('background-only');
    await page.locator('#fullscreen').click(); await expect(page.locator('#open-settings')).toBeVisible(); await page.locator('#fullscreen').click();
    const stable = await page.evaluate(() => window.clockIntervalCalls);
    await page.clock.fastForward(5000); expect(await page.evaluate(() => window.clockIntervalCalls)).toEqual(stable);
    await page.locator('#open-settings').click(); await page.locator('#settings-tab-images').click(); await page.locator('[name="imageInfo"]').uncheck(); await save(page); await page.locator('#close-settings').click();
    await expect(page.locator('#photo-caption')).toBeEmpty(); await expect(page.locator('#information')).toBeHidden();
    await page.locator('#fullscreen').click(); await expect(page.locator('#open-settings')).toBeVisible(); await page.locator('#fullscreen').click(); expect(manifests).toBe(1);
  } finally { await page.goto('about:blank'); await env.close(); }
});
