import { test, expect } from '@playwright/test';
import { settingsEnvironment, scopeClient } from './settings-environment.js';
import { categoryScopes } from '../public/dashboard-settings-categories.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { initialWidgetProfile } from '../public/dashboard-layout.js';
import { categoryTab, saveCategory, seedScopes } from './category-settings.js';

const image = page => page.locator('#photos .photo-layer > img').last();
const widgetIds = ['clock', 'weather', 'calendar', 'bookmarks', 'dashboard-ha', 'dashboard-wol'];
async function seed(page, preferences, followGlobalPhotos = true, mode = 'local') {
  await seedScopes(page.context(), { ...categoryScopes(), images: mode });
  await page.addInitScript(record => {
    if (!localStorage.getItem('dashboard.local-settings.v1')) localStorage.setItem('dashboard.local-settings.v1', JSON.stringify(record));
  }, { schema: 1, revision: 1, preferences, weatherLocation: null, followGlobalPhotos });
}
async function openImages(page) { await page.locator('#open-settings').click(); await categoryTab(page, 'images'); }
async function visibility(page, visible) {
  const mobile = await page.evaluate(() => matchMedia('(max-width: 600px)').matches);
  await openImages(page); await page.getByRole('checkbox', { name: mobile ? 'Show image on mobile' : 'Show image', exact: true }).setChecked(visible);
  await saveCategory(page); await page.locator('#close-settings').click();
}
async function hidden(page) {
  await expect(page.locator('#photos')).toHaveAttribute('hidden', '');
  await expect(page.locator('#photo-caption')).toHaveAttribute('hidden', '');
  await expect(image(page)).toBeHidden(); await expect(page.locator('#photo-caption')).toBeHidden();
}
async function shown(page, photo) {
  await expect(page.locator('#photos')).not.toHaveAttribute('hidden');
  await expect(image(page)).toBeVisible(); await expect(image(page)).toHaveAttribute('src', photo.url);
  await expect.poll(() => image(page).evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  await expect(page.locator('#photo-caption')).toHaveText(photo.name); await expect(page.locator('#photo-caption')).toBeVisible();
}

for (const playback of ['local-following', 'local-independent', 'global']) test(`${playback} saves image visibility without replacing playback and retains it through rotation and reload`, async ({ page }) => {
  const env = await settingsEnvironment(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const mode = playback === 'global' ? 'global' : 'local';
  try {
    const preferences = normalizeDashboardPreferences({ ...env.store.getDashboardPreferences().preferences, interval: 5, background: 'blur', color: '#123456' });
    await seed(page, preferences, playback !== 'local-independent', mode);
    await page.clock.install(); await page.goto(env.base); await shown(page, env.slideshow.snapshot().current);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    const globalBefore = env.store.getDashboardPreferences(); const selection = env.slideshow.snapshot();
    await openImages(page); const checkbox = page.getByRole('checkbox', { name: 'Show image', exact: true });
    await expect(checkbox).toBeChecked(); await checkbox.uncheck(); await expect(page.locator('#photos')).not.toHaveAttribute('hidden');
    await categoryTab(page, 'time'); await categoryTab(page, 'images'); await expect(checkbox).not.toBeChecked();
    await page.locator('#close-settings').click(); await openImages(page); await expect(checkbox).toBeChecked();
    await page.evaluate(() => { window.retainedPhoto = document.querySelector('#photos .photo-layer'); });
    await checkbox.uncheck(); await saveCategory(page); await page.locator('#close-settings').click(); await hidden(page);
    expect(await page.evaluate(() => window.retainedPhoto === document.querySelector('#photos .photo-layer'))).toBe(true);
    expect(env.slideshow.snapshot()).toEqual(selection);
    for (const id of widgetIds) await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color', mode === 'global' ? 'rgb(34, 34, 34)' : 'rgb(18, 52, 86)');
    if (mode === 'local') {
      await expect(page.locator('#photos .photo-blur')).toHaveCount(1);
      expect(env.store.getDashboardPreferences()).toEqual(globalBefore);
    } else expect(env.store.getDashboardPreferences().preferences).toEqual({ ...globalBefore.preferences, imageVisible: false });
    if (playback === 'local-independent') await page.clock.runFor(5000);
    else { await env.clock.advance(60000); await page.clock.runFor(5000); }
    const current = playback === 'local-independent' ? { name: '1.png', url: (await image(page).getAttribute('src')) } : env.slideshow.snapshot().current;
    await expect(page.locator('#photo-caption')).toHaveText(current.name); await hidden(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await hidden(page); await page.reload(); await expect(page.locator('#photos .photo-layer')).toHaveCount(1); await hidden(page);
    await openImages(page); await expect(checkbox).not.toBeChecked();
    if (mode === 'local') await expect(page.locator('#follow-global-photos')).toBeChecked({ checked: playback !== 'local-independent' });
    await page.locator('#close-settings').click();
    const latest = { name: await page.locator('#photo-caption').textContent(), url: await image(page).getAttribute('src') };
    await visibility(page, true); await shown(page, latest);
    expect(errors).toEqual([]);
  } finally { await page.goto('about:blank'); await env.close(); }
});

for (const playback of ['local-following', 'local-independent', 'global']) test(`${playback} retains independent image profiles and fullscreen overrides through save, resize, rotation, and reload`, async ({ page }) => {
  const env = await settingsEnvironment({ photoCount: 1 });
  try {
    const preferences = normalizeDashboardPreferences({ imageInfo: true, background: 'blur', color: '#123456' });
    await seed(page, preferences, playback !== 'local-independent', playback === 'global' ? 'global' : 'local');
    await page.clock.install(); await page.goto(env.base); await expect(image(page)).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    await openImages(page);
    const mobile = page.getByRole('checkbox', { name: 'Show image on mobile', exact: true });
    const fullscreen = page.getByRole('checkbox', { name: 'Hide image in fullscreen', exact: true });
    await mobile.uncheck(); await fullscreen.check();
    await categoryTab(page, 'time'); await categoryTab(page, 'images');
    await expect(mobile).not.toBeChecked(); await expect(fullscreen).toBeChecked();
    await page.locator('#close-settings').click(); await openImages(page);
    await expect(mobile).toBeChecked(); await expect(fullscreen).not.toBeChecked();
    const selection = env.slideshow.snapshot();
    await page.evaluate(() => { window.retainedPhoto = document.querySelector('#photos .photo-layer'); });
    await mobile.uncheck(); await fullscreen.check(); await saveCategory(page); await page.locator('#close-settings').click();
    expect(env.slideshow.snapshot()).toEqual(selection);
    expect(await page.evaluate(() => window.retainedPhoto === document.querySelector('#photos .photo-layer'))).toBe(true);
    for (const width of [600, 601]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 600) await hidden(page); else await expect(image(page)).toBeVisible();
      await page.locator('#fullscreen').click(); await expect(page.locator('#fullscreen')).toHaveText('Exit fullscreen'); await hidden(page);
      await expect(page.locator('#open-settings')).toBeHidden();
      await page.evaluate(() => document.exitFullscreen()); await expect(page.locator('#fullscreen')).toHaveText('Enter fullscreen');
      await expect(page.locator('#open-settings')).toBeVisible();
      if (width === 600) await hidden(page); else await expect(image(page)).toBeVisible();
    }
    await page.setViewportSize({ width: 600, height: 900 });
    if (playback === 'local-independent') await page.clock.runFor(60000);
    else { await env.clock.advance(60000); await page.clock.runFor(5000); }
    await hidden(page); await page.reload(); await expect(page.locator('#photos .photo-layer')).toHaveCount(1); await hidden(page);
    await openImages(page); await expect(mobile).not.toBeChecked(); await expect(fullscreen).toBeChecked();
    // Reverse the profiles and remove the override; mobile becomes visible while desktop remains hidden.
    await page.getByRole('checkbox', { name: 'Show image', exact: true }).uncheck();
    await mobile.check(); await fullscreen.uncheck(); await saveCategory(page); await page.locator('#close-settings').click();
    await expect(image(page)).toBeVisible();
    await page.locator('#fullscreen').click(); await expect(page.locator('#fullscreen')).toHaveText('Exit fullscreen'); await expect(image(page)).toBeVisible();
    await page.evaluate(() => document.exitFullscreen()); await page.setViewportSize({ width: 601, height: 900 }); await hidden(page);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('an old hidden Local image record stays hidden on desktop and mobile without rewriting storage', async ({ page }) => {
  const env = await settingsEnvironment({ photoCount: 1 });
  try {
    const old = normalizeDashboardPreferences({ imageVisible: false, imageInfo: true, background: 'blur' }); delete old.mobileImageVisible; delete old.hideImageFullscreen;
    await seed(page, old); await page.goto(env.base); await expect(page.locator('#photos .photo-layer')).toHaveCount(1);
    const bytes = await page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'));
    for (const width of [601, 600]) { await page.setViewportSize({ width, height: 900 }); await hidden(page); }
    await openImages(page);
    await expect(page.getByRole('checkbox', { name: 'Show image', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Show image on mobile', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Hide image in fullscreen', exact: true })).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('dashboard.local-settings.v1'))).toBe(bytes);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('Local image hiding stays private while Global changes reach only Global Images browsers', async ({ browser }) => {
  const env = await settingsEnvironment(); const clients = [];
  try {
    const local = await scopeClient(browser, env); clients.push(local);
    const a = await scopeClient(browser, env, { ...categoryScopes(), images: 'global' }); clients.push(a);
    const b = await scopeClient(browser, env, { ...categoryScopes(), images: 'global' }); clients.push(b);
    for (const client of clients) { await expect(image(client.page)).toBeVisible(); await client.page.clock.pauseAt(await client.page.evaluate(() => Date.now() + 100)); }
    const before = env.store.getDashboardPreferences();
    await visibility(local.page, false); await hidden(local.page); expect(env.store.getDashboardPreferences()).toEqual(before);
    await expect(image(a.page)).toBeVisible(); await expect(image(b.page)).toBeVisible();
    await visibility(a.page, false); await b.page.clock.runFor(5000); await hidden(b.page); await hidden(local.page);
    const globalHidden = env.store.getDashboardPreferences();
    await visibility(local.page, true); expect(env.store.getDashboardPreferences()).toEqual(globalHidden); await expect(image(local.page)).toBeVisible();
    await hidden(a.page); await hidden(b.page);
    await visibility(a.page, true); await b.page.clock.runFor(5000); await shown(b.page, env.slideshow.snapshot().current);
    await expect(image(local.page)).toBeVisible();
    await openImages(a.page); await a.page.locator('[name="mobileImageVisible"]').uncheck(); await a.page.locator('[name="hideImageFullscreen"]').check();
    await saveCategory(a.page); await a.page.locator('#close-settings').click(); await b.page.clock.runFor(5000);
    for (const client of clients) await client.page.setViewportSize({ width: 600, height: 900 });
    await hidden(a.page); await hidden(b.page); await expect(image(local.page)).toBeVisible();
    for (const client of clients) await client.page.setViewportSize({ width: 601, height: 900 });
    for (const client of [a, b]) {
      await expect(image(client.page)).toBeVisible();
      await client.page.locator('#fullscreen').click(); await expect(client.page.locator('#fullscreen')).toHaveText('Exit fullscreen'); await hidden(client.page);
      await client.page.evaluate(() => document.exitFullscreen()); await expect(image(client.page)).toBeVisible();
    }
    await local.page.locator('#fullscreen').click(); await expect(local.page.locator('#fullscreen')).toHaveText('Exit fullscreen'); await expect(image(local.page)).toBeVisible();
  } finally { for (const client of clients) await client.close(); await env.close(); }
});

for (const custom of [false, true]) test(`${custom ? 'Custom' : 'Automatic'} caption-only layouts keep hidden images and fullscreen settings access across desktop and mobile`, async ({ page }) => {
  const env = await settingsEnvironment({ photoCount: 1 });
  try {
    const allHidden = Object.fromEntries(['time', 'weather', 'calendar', 'bookmarks', 'homeAssistant', 'wol'].flatMap(name => [[`${name}Visible`, false], [`mobile${name[0].toUpperCase()}${name.slice(1)}Visible`, false]]));
    const preferences = normalizeDashboardPreferences({ ...allHidden, imageVisible: false, imageInfo: true, background: 'blur', color: '#123456', ...(custom ? { widgetLayout: { version: 2, desktop: initialWidgetProfile('desktop'), mobile: initialWidgetProfile('mobile') } } : {}) });
    await seed(page, preferences); await page.clock.install(); await page.goto(env.base);
    await expect(page.locator('#photo-caption')).toHaveText(env.slideshow.snapshot().current.name);
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 }); await hidden(page);
      await expect(page.locator('#information')).toBeHidden(); await expect(page.locator('#dashboard-content')).toBeHidden();
      await page.locator('#fullscreen').click(); await expect(page.locator('#fullscreen')).toHaveText('Exit fullscreen');
      await expect(page.locator('#open-settings')).toBeVisible(); await hidden(page);
      await visibility(page, true); await shown(page, env.slideshow.snapshot().current);
      await visibility(page, false); await hidden(page); await page.locator('#fullscreen').click(); await hidden(page);
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.local-settings.v1')).preferences);
    expect(saved).toEqual(preferences);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('a photo completing after a hide save cannot reveal its image, blurred backdrop, or filename', async ({ page }) => {
  const env = await settingsEnvironment({ photoCount: 1 }); let release;
  const gate = new Promise(resolve => { release = resolve; }); let requested;
  const request = new Promise(resolve => { requested = resolve; });
  try {
    await seed(page, normalizeDashboardPreferences({ imageInfo: true, background: 'blur' }));
    const photo = env.slideshow.snapshot().current;
    await page.route(`**${photo.url}`, async route => { const response = await route.fetch(); requested(); await gate; await route.fulfill({ response }); });
    await page.goto(env.base, { waitUntil: 'domcontentloaded' }); await request;
    await visibility(page, false); await hidden(page); release();
    await expect(page.locator('#photos .photo-layer')).toHaveCount(1); await expect(page.locator('#photo-caption')).toHaveText(photo.name); await hidden(page);
    await expect(page.locator('#photos .photo-blur')).toHaveCount(1);
    await visibility(page, true); await shown(page, photo);
  } finally { release(); await page.goto('about:blank'); await env.close(); }
});

test('Custom widget geometry stays unchanged when images hide and fullscreen or mobile presentation changes', async ({ page }) => {
  const env = await settingsEnvironment({ photoCount: 1 });
  try {
    const widgetLayout = { version: 2, desktop: initialWidgetProfile('desktop'), mobile: initialWidgetProfile('mobile') };
    await seed(page, normalizeDashboardPreferences({ imageInfo: true, widgetLayout }));
    await page.goto(env.base); await shown(page, env.slideshow.snapshot().current);
    const boxes = async () => Object.fromEntries(await Promise.all(widgetIds.map(async id => [id, await page.locator(`#${id}`).boundingBox()])));
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('body')).toHaveClass(/custom-widget-layout/);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const before = await boxes(); await visibility(page, false); await hidden(page);
      expect(await boxes()).toEqual(before);
      for (const id of widgetIds) await expect(page.locator(`#${id}`)).toBeVisible();
      await page.locator('#fullscreen').click(); await expect(page.locator('#fullscreen')).toHaveText('Exit fullscreen'); await hidden(page);
      await page.evaluate(() => document.exitFullscreen()); await hidden(page);
      await expect(page.locator('#open-settings')).toBeVisible(); await visibility(page, true); await shown(page, env.slideshow.snapshot().current);
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.local-settings.v1')).preferences.widgetLayout)).toEqual(widgetLayout);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('hiding during an active photo transition hides every layer without resetting the player', async ({ page }) => {
  const env = await settingsEnvironment();
  try {
    await seed(page, normalizeDashboardPreferences({ imageInfo: true, animation: 'fade', duration: 3, background: 'blur' }));
    await page.clock.install(); await page.goto(env.base); await shown(page, env.slideshow.snapshot().current);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    await env.clock.advance(60000); await page.clock.runFor(5000);
    await expect(image(page)).toHaveAttribute('src', env.slideshow.snapshot().current.url);
    await expect.poll(() => page.locator('#photos').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBeGreaterThan(0);
    await visibility(page, false); await hidden(page);
    for (const layer of await page.locator('#photos .photo-layer').all()) await expect(layer).toBeHidden();
    await page.clock.runFor(4000); await expect(page.locator('#photos .photo-layer')).toHaveCount(1); await hidden(page);
    await visibility(page, true); await shown(page, env.slideshow.snapshot().current);
  } finally { await page.goto('about:blank'); await env.close(); }
});
