import { test, expect } from '@playwright/test';
import { settingsEnvironment } from './settings-environment.js';

async function shown(page, url) {
  const image = page.locator('#photos .photo-layer > img').last();
  await expect(image).toHaveAttribute('src', url);
  await expect(image).toBeVisible();
  await expect(page.locator('#photos .photo-layer').last()).toHaveCSS('opacity', '1');
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
}

async function scope(page, mode) {
  await page.locator('#open-settings').click(); await page.locator('#settings-scope').selectOption(mode);
  await expect(page.locator('#settings-status')).toHaveText(mode === 'local' ? 'Preferences apply to this browser only.' : 'Preferences are shared across all browsers.');
  await page.locator('#close-settings').click();
}

test('default Local displays real image bytes, rotates independently, and switches to and from Global', async ({ page }) => {
  const env = await settingsEnvironment(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const legacy = await (await fetch(`${env.base}/api/dashboard/photos`)).json();
    const manifest = await (await fetch(`${env.base}/api/dashboard/photos/local`)).json();
    const shared = await (await fetch(`${env.base}/api/dashboard/slideshow`)).json();
    expect(legacy.available).toBe(true); expect(manifest.available).toBe(true); expect(manifest.count).toBe(2); expect(shared.current).toEqual(manifest.photos[0]);
    const response = await fetch(env.base + manifest.photos[0].url);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/png'); expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const before = env.store.exportDashboardSettings(); const selection = env.slideshow.snapshot();
    await page.clock.install(); await page.goto(env.base);
    await expect(page.locator('#settings-scope')).toHaveValue('local');
    const initial = page.locator('#photos .photo-layer > img').last(); await expect(initial).toBeVisible();
    const initialUrl = await initial.getAttribute('src'); expect(manifest.photos.map(photo => photo.url)).toContain(initialUrl); await shown(page, initialUrl);
    await page.locator('#open-settings').click(); await page.locator('#settings-tab-images').click();
    await page.locator('[name="order"]').selectOption('name'); await page.locator('[name="interval"]').fill('5'); await page.locator('[name="animation"]').selectOption('none');
    await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toHaveText('Preferences saved for this browser.'); await page.locator('#close-settings').click();
    await shown(page, manifest.photos[0].url); await page.clock.fastForward(5000); await shown(page, manifest.photos[1].url);
    expect(env.store.exportDashboardSettings()).toEqual(before); expect(env.slideshow.snapshot()).toEqual(selection);
    await scope(page, 'global'); await shown(page, shared.current.url);
    await scope(page, 'local'); await shown(page, manifest.photos[0].url);
    await page.clock.fastForward(5000); await shown(page, manifest.photos[1].url);
    expect(env.store.exportDashboardSettings()).toEqual(before); expect(env.slideshow.snapshot()).toEqual(selection); expect(errors).toEqual([]);
  } finally { await page.goto('about:blank'); await env.close(); }
});

for (const mode of ['local', 'global']) test(`${mode} retries a failed first image at the same URL without rotation or reload`, async ({ page }) => {
  const env = await settingsEnvironment({ photoCount: 1 }); let failed = false; const requests = []; const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    if (mode === 'global') await page.addInitScript(() => localStorage.setItem('dashboard.settings-scope.v1', JSON.stringify({ schema: 1, mode: 'global' })));
    const snapshot = env.slideshow.snapshot(); const before = env.store.exportDashboardSettings();
    await page.route(`**${snapshot.current.url}`, route => {
      requests.push(route.request().url());
      if (!failed) { failed = true; return route.fulfill({ contentType: 'image/png', body: 'temporarily invalid image', headers: { 'Cache-Control': 'no-store' } }); }
      return route.continue();
    });
    await page.clock.install(); await page.goto(env.base);
    await expect(page.locator('#photo-status')).toHaveText('The selected background could not be displayed. Retrying automatically.');
    await expect(page.locator('#photos img')).toHaveCount(0);
    await page.clock.runFor(5000); await shown(page, snapshot.current.url);
    await expect(page.locator('#photo-status')).toHaveText('Using 1 NFS background in this playback sequence.');
    expect(requests.length).toBeGreaterThan(1); expect(new Set(requests).size).toBe(1);
    expect(env.slideshow.snapshot()).toEqual(snapshot); expect(env.store.exportDashboardSettings()).toEqual(before);
    expect(await page.locator('#settings-scope').inputValue()).toBe(mode); expect(errors).toEqual([]);
    await page.clock.runFor(5000); await expect(page.locator('#photos .photo-layer')).toHaveCount(1);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('Local cooperative completion delivers lookahead without polling or consuming a Global selection', async ({ page }) => {
  const env = await settingsEnvironment({ photoCount: 20 }); const requests = [];
  await page.route('**/local-lookahead-check', route => route.fulfill({ contentType: 'text/html', body: '<div id="frame"></div>' }));
  page.on('request', request => { if (/\/api\/dashboard\/photos\/[A-Za-z0-9_-]{16,128}$/.test(new URL(request.url()).pathname)) requests.push(new URL(request.url()).pathname); });
  try {
    const global = env.slideshow.snapshot(); await page.clock.install(); await page.goto(`${env.base}/local-lookahead-check`);
    await page.evaluate(async () => {
      const { createLocalPhotoController } = await import('/dashboard-local-photos.js');
      window.blockFill = true; window.selections = [];
      window.localPhotos = createLocalPhotoController({ yieldWork: () => window.blockFill ? new Promise(resolve => { window.releaseFill = resolve; }) : undefined,
        clear() {}, report() {}, show(photo) { const frame = document.querySelector('#frame'); frame.firstChild?.removeAttribute('src'); frame.replaceChildren(photo.resource.image); window.selections.push(photo.file.name); } });
      window.localPhotos.configure({ order: 'name', interval: 5 }); await window.localPhotos.load();
    });
    await expect(page.locator('#frame img')).toBeVisible(); expect(requests).toEqual([global.current.url]);
    await page.evaluate(() => { window.initialImage = document.querySelector('#frame img'); window.blockFill = false; window.releaseFill(); });
    await expect.poll(() => requests.length).toBe(2); expect(await page.evaluate(() => document.querySelector('#frame img') === window.initialImage)).toBe(true);
    await page.evaluate(() => { window.blockFill = true; });
    for (let i = 0; i < 11; i++) { await page.clock.runFor(5000); await expect.poll(() => page.evaluate(() => window.selections.length)).toBe(i + 2); }
    const count = requests.length; await page.evaluate(() => { window.blockFill = false; window.releaseFill(); });
    await expect.poll(() => requests.length).toBe(count + 1); expect(await page.evaluate(() => window.selections.length)).toBe(12);
    expect(await page.evaluate(() => new Set(window.selections).size)).toBe(12); expect(env.slideshow.snapshot()).toEqual(global);
    await page.evaluate(() => window.localPhotos.dispose());
  } finally { await page.goto('about:blank'); await env.close(); }
});
