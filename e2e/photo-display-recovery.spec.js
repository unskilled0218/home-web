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
