import { expect } from '@playwright/test';
import { globalTest as test } from './global-fixtures.js';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createPhotoLibrary } from '../src/photo-library.js';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { slideshowClock } from '../test/fixtures/photo-slideshow.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function environment({ count = 3, enabled = true, animation = 'none' } = {}) {
  const directory = await mkdtemp('/tmp/opencode/browser-slideshow-'); const store = createStore(path.join(directory, 'app.db')); const clock = slideshowClock();
  for (let i = 0; i < count; i++) await writeFile(path.join(directory, `${i}.png`), png);
  const library = createPhotoLibrary({ root: directory }); let unavailable = false; let scans = 0;
  const photoLibrary = { open: library.open, async list() { scans++; return unavailable ? { available: false, photos: [] } : library.list(); } };
  store.saveDashboardPreferences(normalizeDashboardPreferences({ order: 'random', interval: 5, imageInfo: true, animation }), 0);
  const create = () => createPhotoSlideshow({ ...clock, photoLibrary, enabled, preferences: store.getDashboardPreferences().preferences, random: () => 0 });
  let slideshow = create();
  const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store, photoLibrary, slideshow: { snapshot: () => slideshow.snapshot(), configure: (next) => slideshow.configure(next) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); await slideshow.start();
  return {
    base: `http://127.0.0.1:${server.address().port}`, clock, store, get slideshow() { return slideshow; }, scans: () => scans,
    setUnavailable(value) { unavailable = value; },
    async empty() { for (let i = 0; i < count; i++) await rm(path.join(directory, `${i}.png`), { force: true }); },
    async restart() { await slideshow.stop(); slideshow = create(); await slideshow.start(); },
    async close() { await Promise.all([slideshow.stop(), server.lifecycle.shutdown()]); store.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

async function shown(page, current) {
  await expect(page.locator('#photo-caption')).toHaveText(current.name);
  await expect(page.locator('#photos .photo-layer > img').last()).toHaveAttribute('src', current.url);
  await expect.poll(() => page.locator('#photos .photo-layer > img').last().evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
}

test('zero-viewer rotation, reopen, two-browser convergence, visibility and persisted-page resume follow the real server', async ({ browser }) => {
  const env = await environment(); const pages = [];
  try {
    await env.clock.advance(10_000); const selected = env.slideshow.snapshot(); expect(selected.revision).toBe(3);
    const first = await browser.newPage(); pages.push(first); await first.clock.install(); await first.goto(env.base); await shown(first, selected.current);
    await first.close(); await env.clock.advance(10_000); const next = env.slideshow.snapshot(); expect(next.revision).toBe(5);
    const a = await browser.newPage(); const b = await browser.newPage(); pages.push(a, b);
    await a.clock.install(); await b.clock.install(); await a.goto(env.base); await b.goto(env.base); await shown(a, next.current); await shown(b, next.current);
    expect(env.slideshow.snapshot().revision).toBe(next.revision); const scans = env.scans();
    await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await env.clock.advance(5000); await a.clock.fastForward(5000); await shown(a, env.slideshow.snapshot().current); await expect(b.locator('#photo-caption')).toHaveText(next.current.name);
    await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); }); await shown(b, env.slideshow.snapshot().current);
    await b.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await env.clock.advance(5000);
    await b.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await shown(b, env.slideshow.snapshot().current);
    expect(env.scans()).toBe(scans);
  } finally { for (const page of pages) if (!page.isClosed()) await page.close(); await env.close(); }
});

test('unchanged snapshots preserve DOM layers; confirmed preferences update presentation; instance restart is adopted', async ({ page }) => {
  const env = await environment({ animation: 'fade' });
  try {
    await page.clock.install(); await page.goto(env.base); await shown(page, env.slideshow.snapshot().current);
    await page.evaluate(() => { window.savedPhotoLayer = document.querySelector('.photo-layer'); });
    await page.clock.fastForward(5000); expect(await page.evaluate(() => window.savedPhotoLayer === document.querySelector('.photo-layer'))).toBe(true);
    const before = env.slideshow.snapshot(); const saved = env.store.getDashboardPreferences();
    const response = await fetch(`${env.base}/api/dashboard/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, preferences: { ...saved.preferences, opacity: 0.5, imageInfo: false } }) }); expect(response.status).toBe(200);
    await page.clock.fastForward(5000); await expect(page.locator('#photo-caption')).toBeEmpty(); await expect(page.locator('.photo-layer')).toHaveCSS('opacity', '0.5');
    expect(await page.evaluate(() => window.savedPhotoLayer === document.querySelector('.photo-layer'))).toBe(true); expect(env.slideshow.snapshot().revision).toBe(before.revision); expect(env.slideshow.snapshot().nextChangeAt).toBe(before.nextChangeAt);
    await env.clock.advance(5000); await page.clock.fastForward(5000); await expect(page.locator('#photos .photo-layer > img').last()).toHaveAttribute('src', env.slideshow.snapshot().current.url);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(page.locator('.photo-layer')).toHaveCount(1);
    await env.restart(); expect(env.slideshow.snapshot().instanceId).not.toBe(before.instanceId); await page.clock.fastForward(5000);
    await expect(page.locator('#photos .photo-layer > img').last()).toHaveAttribute('src', env.slideshow.snapshot().current.url);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('failed image decode retains last-good background and recovers on a later real selection', async ({ page }) => {
  const env = await environment();
  try {
    await page.clock.install(); await page.goto(env.base); const previous = env.slideshow.snapshot().current; await shown(page, previous);
    await env.clock.advance(5000); const failed = env.slideshow.snapshot().current;
    await page.route(`**${failed.url}`, (route) => route.fulfill({ contentType: 'image/png', body: 'not an image' }));
    await page.clock.fastForward(5000); await expect(page.locator('#photo-caption')).toHaveText(previous.name);
    await env.clock.advance(5000); await page.clock.fastForward(5000); await shown(page, env.slideshow.snapshot().current);
  } finally { await page.goto('about:blank'); await env.close(); }
});

for (const mode of ['single', 'empty', 'disabled', 'unavailable']) test(`${mode} source uses bounded snapshots and solid-background fallback`, async ({ page }) => {
  const env = await environment({ count: mode === 'empty' ? 0 : 1, enabled: mode !== 'disabled' });
  try {
    if (mode === 'unavailable') { env.setUnavailable(true); await env.restart(); }
    await page.clock.install(); await page.goto(env.base);
    if (mode === 'single') {
      await shown(page, env.slideshow.snapshot().current); const revision = env.slideshow.snapshot().revision;
      await env.clock.advance(15_000); await page.clock.fastForward(15_000); expect(env.slideshow.snapshot().revision).toBe(revision); expect(env.slideshow.snapshot().nextChangeAt).toBe(null);
      await env.empty(); await env.restart(); await page.clock.fastForward(5000); await expect(page.locator('.photo-layer')).toHaveCount(0);
    } else await expect(page.locator('.photo-layer')).toHaveCount(0);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.locator('#open-settings')).toBeVisible(); expect(env.slideshow.snapshot().nextChangeAt).toBe(null);
  } finally { await page.goto('about:blank'); await env.close(); }
});
