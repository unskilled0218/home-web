import { expect } from '@playwright/test';
import { globalTest as test } from './global-fixtures.js';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createPhotoLibrary } from '../src/photo-library.js';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { slideshowClock } from '../test/fixtures/photo-slideshow.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function environment({ count = 3, enabled = true, animation = 'none', yieldWork, presentation = {} } = {}) {
  const directory = await mkdtemp('/tmp/opencode/browser-slideshow-'); const store = createStore(path.join(directory, 'app.db')); const clock = slideshowClock();
  for (let i = 0; i < count; i++) await writeFile(path.join(directory, `${i}.png`), png);
  let unavailable = false; let scans = 0;
  const library = createPhotoLibrary({ root: directory, ...clock, fs: { ...fs, realpath(...args) { if (unavailable) return Promise.reject(Object.assign(new Error('Source unavailable'), { code: 'EIO' })); return fs.realpath(...args); } } });
  const photoLibrary = { ...library, async refresh() { scans++; return library.refresh(); } };
  store.saveDashboardPreferences(normalizeDashboardPreferences({ order: 'random', interval: 5, imageInfo: true, animation, ...presentation }), 0);
  const create = () => createPhotoSlideshow({ ...clock, photoLibrary, enabled, yieldWork, preferences: store.getDashboardPreferences().preferences, random: () => 0 });
  let slideshow = create();
  const server = createDashboardServer({ runtimeConfig: { allowedHosts: ['127.0.0.1'] }, store, photoLibrary, photoSourceEnabled: enabled, slideshow: { snapshot: options => slideshow.snapshot(options), configure: (next) => slideshow.configure(next) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); await slideshow.start();
  return {
    base: `http://127.0.0.1:${server.address().port}`, clock, store, get slideshow() { return slideshow; }, scans: () => scans,
    setUnavailable(value) { unavailable = value; },
    async empty() { for (let i = 0; i < count; i++) await rm(path.join(directory, `${i}.png`), { force: true }); },
    async restart() { await slideshow.stop(); slideshow = create(); await slideshow.start(); },
    async close() { await Promise.all([slideshow.stop(), library.stop(), server.lifecycle.shutdown()]); store.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

async function shown(page, current) {
  await expect(page.locator('#photo-caption')).toHaveText(current.name, { timeout: 10000 });
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
    const upcoming = env.slideshow.snapshot({ version: 2 }).next;
    await page.route(`**${upcoming.url}`, (route) => route.fulfill({ contentType: 'image/png', body: 'not an image' }));
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

test('full Global library stays shared while Settings counts persist across decode errors, stale scans and scope changes', async ({ browser }) => {
  const env = await environment({ count: 151 }); const a = await browser.newPage(); const b = await browser.newPage(); let imageReads = 0;
  try {
    const upcoming = env.slideshow.snapshot({ version: 2 }).next;
    await a.route(`**${upcoming.url}`, route => route.fulfill({ contentType: 'image/png', body: 'bad image' }));
    await a.clock.install(); await b.clock.install(); a.on('request', request => { if (/\/api\/dashboard\/photos\/[A-Za-z0-9_-]{16,128}$/.test(new URL(request.url()).pathname)) imageReads++; });
    await a.goto(env.base); await b.goto(env.base); await shown(a, env.slideshow.snapshot().current); await shown(b, env.slideshow.snapshot().current);
    expect(env.slideshow.snapshot().count).toBe(151); expect(imageReads).toBeLessThan(5);
    await a.locator('#open-settings').click(); await a.locator('#settings-tab-images').click(); await expect(a.locator('#photo-count')).toHaveText('Global playable image files: 151.');
    await env.clock.advance(5000); const failed = env.slideshow.snapshot().current;
    await a.route(`**${failed.url}`, route => route.fulfill({ contentType: 'image/png', body: 'bad image' })); await a.clock.fastForward(5000);
    await expect(a.locator('#photo-status')).toContainText('could not be displayed'); await expect(a.locator('#photo-count')).toHaveText('Global playable image files: 151.');
    await b.clock.fastForward(5000); await shown(b, failed);
    env.setUnavailable(true); await env.clock.advance(60000);
    await expect.poll(async () => (await (await fetch(env.base + '/api/dashboard/photos/status')).json()).stale).toBe(true);
    await a.clock.fastForward(5000); await expect(a.locator('#photo-count')).toContainText('151. Last completed count is stale.');
    env.setUnavailable(false); await env.restart(); await a.locator('#close-settings').click();
    await a.locator('#open-settings').click(); await a.locator('#settings-tab-images').click(); await expect(a.locator('#photo-count')).toHaveText('Global playable image files: 151.');
    await a.locator('#settings-tab-images').click(); await a.locator('#settings-scope-images').selectOption('local');
    await expect(a.locator('#photo-count')).toHaveText('Global playable image files: 151.');
    const local = await (await fetch(env.base + '/api/dashboard/photos/local')).json(); expect(local.count).toBe(100); expect(env.slideshow.snapshot().count).toBe(151);
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('Settings counts distinguish initial unknown from completed zero and stop polling while closed or hidden', async ({ page }) => {
  const env = await environment({ count: 0 }); let reads = 0;
  let status = { version: 1, enabled: true, available: false, loading: true, complete: false, stale: false, error: null, counts: null, progress: 0 };
  await page.route('**/api/dashboard/photos/status', route => { reads++; return route.fulfill({ json: status }); });
  try {
    await page.clock.install(); await page.goto(env.base); await page.locator('#open-settings').click(); await page.locator('#settings-tab-images').click();
    await expect(page.locator('#photo-count')).toHaveText('Image file count: unknown. Scanning image files… 0 entries examined.'); expect(reads).toBe(1);
    status = { ...status, available: true, loading: false, complete: true, counts: { supported: 0, eligible: 0, filenameExcluded: 0, permissionExcluded: 0, raceExcluded: 0, fileExcluded: 0 } };
    await page.clock.fastForward(5000); await expect(page.locator('#photo-count')).toHaveText('Global playable image files: 0.');
    await page.locator('#close-settings').click(); const before = reads; await page.clock.fastForward(15000); expect(reads).toBe(before);
    await page.locator('#open-settings').click(); await page.locator('#settings-tab-images').click(); await expect.poll(() => reads).toBe(before + 1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = reads; await page.clock.fastForward(15000); expect(reads).toBe(hidden);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); }); await expect.poll(() => reads).toBe(hidden + 1);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('late Global previews arrive before selection, including an exhausted metadata-batch boundary', async ({ page }) => {
  let blocked = true; let release;
  const env = await environment({ count: 20, yieldWork: () => blocked ? new Promise(resolve => { release = resolve; }) : undefined });
  const requests = [];
  page.on('request', request => { if (/\/api\/dashboard\/photos\/[A-Za-z0-9_-]+$/.test(new URL(request.url()).pathname)) requests.push(new URL(request.url()).pathname); });
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode; window.decodedPhotos = new Map();
    HTMLImageElement.prototype.decode = async function () { await decode.call(this); window.decodedPhotos.set(this.getAttribute('src'), new WeakRef(this)); };
  });
  try {
    await page.clock.install(); await page.goto(env.base); const first = env.slideshow.snapshot({ version: 2 }); await shown(page, first.current);
    expect(first.next).toBe(null); expect(requests).toEqual([first.current.url]);
    await page.evaluate(() => { window.heldFrame = document.querySelector('#photos img'); });
    blocked = false; release(); await expect.poll(() => env.slideshow.snapshot({ version: 2 }).next !== null).toBe(true);
    const next = env.slideshow.snapshot({ version: 2 }).next;
    await page.clock.runFor(500); await expect.poll(() => requests.includes(next.url)).toBe(true);
    await expect(page.locator('#photo-caption')).toHaveText(first.current.name);
    expect(await page.evaluate(() => window.heldFrame === document.querySelector('#photos img'))).toBe(true);
    expect(new Set(requests).size).toBe(2); blocked = true;
    const names = new Set([first.current.name]);
    for (let i = 0; i < 11; i++) {
      await env.clock.advance(5000); await page.clock.runFor(5000); const selected = env.slideshow.snapshot({ version: 2 }); await shown(page, selected.current);
      expect(names.has(selected.current.name)).toBe(false); names.add(selected.current.name);
      expect(await page.evaluate(url => window.decodedPhotos.get(url)?.deref() === document.querySelector('#photos img'), selected.current.url)).toBe(true);
    }
    const boundary = env.slideshow.snapshot({ version: 2 }); expect(boundary.next).toBe(null);
    const reads = requests.length; blocked = false; release(); await expect.poll(() => env.slideshow.snapshot({ version: 2 }).next !== null).toBe(true);
    const ready = env.slideshow.snapshot({ version: 2 }); expect(ready.revision).toBe(boundary.revision); expect(ready.nextChangeAt).toBe(boundary.nextChangeAt);
    await page.clock.runFor(500); await expect.poll(() => requests.length).toBeGreaterThan(reads); expect(requests.at(-1)).toBe(ready.next.url);
    await expect(page.locator('#photo-caption')).toHaveText(boundary.current.name);
  } finally { blocked = false; release?.(); await page.goto('about:blank'); await env.close(); }
});

test('large-image resource ownership remains bounded through promotions, blur transitions and a stalled/failing preview', async ({ page }) => {
  test.setTimeout(120000);
  const env = await environment({ count: 20, animation: 'fade', presentation: { background: 'blur', duration: 1 } });
  let imageRequests = 0; let stalled; let stalledOnce = false; const requestedUrls = new Set(); const ownership = [];
  const data = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1536; const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 2048, 1536); gradient.addColorStop(0, '#125'); gradient.addColorStop(1, '#fed'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2048, 1536); return canvas.toDataURL('image/png').split(',')[1]; });
  const bytes = Buffer.from(data, 'base64');
  await page.route(/\/api\/dashboard\/photos\/[A-Za-z0-9_-]{16,128}$/, route => { imageRequests++; requestedUrls.add(route.request().url()); if (requestedUrls.size === 3 && !stalledOnce) { stalledOnce = true; stalled = route; return; } return route.fulfill({ contentType: 'image/png', body: bytes }); });
  await page.addInitScript(() => {
    window.photoDecodes = []; window.photoResources = []; window.releasedPhotos = 0;
    const decode = HTMLImageElement.prototype.decode; const remove = HTMLImageElement.prototype.removeAttribute;
    HTMLImageElement.prototype.decode = async function () {
      const start = performance.now(); window.photoResources.push(new WeakRef(this));
      try { await decode.call(this); window.photoDecodes.push({ width: this.naturalWidth, height: this.naturalHeight, durationMs: performance.now() - start }); } catch (error) { throw error; }
    };
    HTMLImageElement.prototype.removeAttribute = function (name) { if (name === 'src' && this.hasAttribute('src')) window.releasedPhotos++; return remove.call(this, name); };
  });
  const sample = async () => page.evaluate(() => ({ foreground: document.querySelectorAll('.photo-layer > img:not(.photo-blur)').length, blur: document.querySelectorAll('.photo-blur').length, speculative: window.photoResources.filter(ref => { const image = ref.deref(); return image?.getAttribute('src') && !image.isConnected; }).length, released: window.releasedPhotos }));
  try {
    await page.goto(env.base); await shown(page, env.slideshow.snapshot().current);
    await expect.poll(() => requestedUrls.size).toBe(2); ownership.push(await sample());
    await env.clock.advance(5000); await shown(page, env.slideshow.snapshot().current); await expect.poll(() => Boolean(stalled)).toBe(true);
    const held = env.slideshow.snapshot().current; ownership.push(await sample());
    await env.clock.advance(5000);
    await page.waitForResponse(async response => response.url().includes('/api/dashboard/slideshow?') && (await response.json()).revision === env.slideshow.snapshot().revision);
    await expect(page.locator('#photo-caption')).toHaveText(held.name);
    await stalled.fulfill({ contentType: 'image/png', body: 'invalid image' }); stalled = undefined;
    await expect(page.locator('#photo-status')).toContainText('could not be displayed'); await expect(page.locator('#photo-caption')).toHaveText(held.name);
    for (let i = 0; i < 6; i++) {
      await env.clock.advance(5000); await shown(page, env.slideshow.snapshot().current); ownership.push(await sample());
      await expect(page.locator('.photo-layer')).toHaveCount(1); ownership.push(await sample());
    }
    for (const entry of ownership) { expect(entry.foreground).toBeLessThanOrEqual(2); expect(entry.blur).toBeLessThanOrEqual(2); expect(entry.speculative).toBeLessThanOrEqual(1); }
    const decodes = await page.evaluate(() => window.photoDecodes); expect(decodes.every(row => row.width === 2048 && row.height === 1536)).toBe(true);
    expect(ownership.at(-1).released).toBeGreaterThan(10); expect(requestedUrls.size).toBeLessThanOrEqual(10); expect(imageRequests).toBeLessThanOrEqual(24);
    console.log(JSON.stringify({ photoBrowserBenchmark: { dimensions: [2048, 1536], compressedBytes: bytes.length, decodedRgbaBytesPerImage: 2048 * 1536 * 4, imageRequests, distinctImageUrls: requestedUrls.size, decodes, ownership } }));
  } finally { await stalled?.abort().catch(() => {}); await page.goto('about:blank'); await env.close(); }
});
