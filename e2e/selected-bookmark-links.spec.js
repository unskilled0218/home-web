import { expect, test as base } from '@playwright/test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';

async function environment() {
  const directory = mkdtempSync('/tmp/opencode/selected-bookmarks-'); const filename = `${directory}/dashboard.db`; const secret = Buffer.alloc(32, 7).toString('base64');
  let store; let server; let port = 0; let url; let failure = false; let denied = false; let reads = []; let name = 'Docs'; let moved = false; let missing = false; let largeRoot = 0;
  const contexts = new Set();
  const collections = [{ id: 1, name: 'Root', children: [{ id: 2, name: 'Child', children: [{ id: 3, name: 'Deep', children: [] }] }] }, { id: 4, name: 'Other', children: [] }];
  function records(id) {
    if (id === 1 && largeRoot) return Array.from({ length: largeRoot }, (_, index) => ({ id: 1000 + index, name: `Catalog ${index}`, url: `${url}/api/health?link=${1000 + index}` }));
    if (id === 1) return [...(!moved && !missing ? [{ id: 1, name, url: `${url}/api/health?link=1` }] : []), { id: 2, name: 'Same', url: `${url}/api/health?link=2` }, { id: 90, name: 'Unsafe', url: 'javascript:alert(1)' }];
    if (id === 2) return [{ id: 3, name: 'Same', url: `${url}/api/health?link=3` }];
    if (id === 3) return [{ id: 4, name: 'Deep link', url: `${url}/api/health?link=4` }];
    return moved && !missing ? [{ id: 1, name, url: `${url}/api/health?link=1` }] : [];
  }
  const linkwarden = { clearCache() {}, listCollections: async () => collections, getBookmarks: async ({ collectionId }) => {
    reads.push(collectionId);
    if (denied) throw Object.assign(new Error('Folder denied.'), { code: 'LINKWARDEN_ACCESS_DENIED' });
    if (failure) throw new Error('Transient provider failure.');
    return { bookmarks: records(collectionId), stale: false, truncated: false };
  } };
  async function start() {
    store = createStore(filename); server = createDashboardServer({ store, linkwarden, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret } });
    server.listen(port, '127.0.0.1'); await once(server, 'listening'); port = server.address().port; url = `http://127.0.0.1:${port}`;
  }
  async function stop() { await server.lifecycle.shutdown({ graceMs: 100 }); store.close(); }
  await start(); store.saveLinkwarden({ baseUrl: 'https://links.test', username: 'sam', encryptedAccessToken: encryptApiKey('fixture-token', secret) });
  return { get url() { return url; }, get store() { return store; }, contexts, records, get reads() { return reads; }, clearReads() { reads = []; }, fail(value) { failure = value; }, deny(value) { denied = value; }, rename(value) { name = value; }, move() { moved = true; }, remove() { missing = true; }, restore() { missing = false; }, large(value) { largeRoot = value; },
    async restart() { await stop(); await start(); },
    async replaceSource() { const response = await fetch(url + '/api/linkwarden', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://another.test', username: 'sam', accessToken: 'replacement' }) }); expect(response.status).toBe(200); },
    async close() { for (const context of contexts) await context.close(); await stop(); rmSync(directory, { recursive: true, force: true }); }
  };
}

const test = base.extend({ env: async ({}, use) => { const env = await environment(); try { await use(env); } finally { await env.close(); } } });
async function client(browser, env, width = 1200) {
  const context = await browser.newContext({ viewport: { width, height: 850 } }); env.contexts.add(context); const page = await context.newPage(); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message)); await page.clock.install(); await page.goto(env.url); await expect(page.locator('#settings-status')).toHaveText('Preferences are shared across all browsers.');
  return { page, errors };
}
async function open(page) { await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click(); }
const box = (page, name, folder = 'Root') => page.getByRole('checkbox', { name: new RegExp(`^${name} · ${folder} ·`) });
async function save(page) { await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toHaveText('Preferences saved for all browsers.'); }
async function poll(page, ms = 5000) { await page.clock.fastForward(ms); }

test('setup and explicit empty stay distinct; picker drafts filter only after saving and survive server restart', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await expect(page.locator('#bookmarks-status')).toHaveText('Choose links in Settings → Bookmarks.'); expect(env.reads).toEqual([]);
  await open(page); await expect(box(page, 'Docs')).toBeVisible(); await expect(box(page, 'Same')).toBeVisible(); await expect(box(page, 'Unsafe')).toHaveCount(0);
  await page.getByLabel('Linkwarden access token', { exact: true }).fill('unsaved-secret'); await box(page, 'Docs').check(); await expect(page.locator('#bookmark-tree a')).toHaveCount(0);
  await save(page); await expect(page.getByLabel('Linkwarden access token', { exact: true })).toHaveValue('unsaved-secret'); await page.locator('#close-settings').click(); await expect(page.locator('#bookmark-tree a')).toHaveCount(1); await expect(page.getByRole('link', { name: 'Docs', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('link', { name: 'Docs', exact: true })).toBeVisible(); await env.restart(); await page.reload(); await expect(page.getByRole('link', { name: 'Docs', exact: true })).toBeVisible();
  await open(page); await expect(box(page, 'Same')).toBeVisible(); await page.locator('#bookmark-select-none').click(); await save(page); await page.locator('#close-settings').click(); await expect(page.locator('#bookmarks-status')).toHaveText('No bookmark links selected.'); await expect(page.locator('#bookmark-tree a')).toHaveCount(0); await page.reload(); await expect(page.locator('#bookmarks-status')).toHaveText('No bookmark links selected.'); expect(errors).toEqual([]);
});

test('mouse and keyboard links open protected loopback tabs while the dashboard stays usable', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await open(page); await box(page, 'Docs').check(); await save(page); await page.locator('#close-settings').click();
  const link = page.getByRole('link', { name: 'Docs', exact: true });
  for (const keyboard of [false, true]) {
    const popup = page.waitForEvent('popup'); if (keyboard) { await link.focus(); await page.keyboard.press('Enter'); } else await link.click();
    const tab = await popup; await tab.waitForLoadState(); expect(tab.url()).toBe(`${env.url}/api/health?link=1`); expect(await tab.evaluate(() => window.opener)).toBeNull(); expect(page.url()).toBe(env.url + '/'); await tab.close();
  }
  await open(page); await expect(box(page, 'Docs')).toBeChecked(); expect(errors).toEqual([]);
});

test('Settings contains direct links within folder branches and the dashboard omits every parent label', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await open(page);
  const root = page.locator('#bookmark-picker-folders > li > details').filter({ has: page.locator(':scope > summary', { hasText: 'Root' }) });
  await expect(root.locator(':scope > .bookmark-picker-links')).toContainText('Docs'); await expect(root.locator(':scope > .bookmark-picker-links')).not.toContainText('Deep link');
  const child = root.locator(':scope > ul:not(.bookmark-picker-links) > li > details'); await child.locator(':scope > summary').click(); await expect(child.locator(':scope > .bookmark-picker-links')).toContainText('Same');
  const deep = child.locator(':scope > ul:not(.bookmark-picker-links) > li > details'); await deep.locator(':scope > summary').click(); await expect(deep.locator(':scope > .bookmark-picker-links')).toContainText('Deep link');
  await box(page, 'Deep link', 'Root / Child / Deep').check(); await save(page); await page.locator('#close-settings').click(); await expect(page.locator('#bookmark-tree > li > a')).toHaveText(['Deep link']); await expect(page.locator('#bookmark-tree details, #bookmark-tree summary, #bookmark-tree ul')).toHaveCount(0); await expect(page.locator('#bookmark-tree')).not.toContainText('Root'); await expect(page.locator('#bookmark-tree')).not.toContainText('Child');
  await open(page); await box(page, 'Deep link', 'Root / Child / Deep').focus(); await poll(page, 300000); await expect(box(page, 'Deep link', 'Root / Child / Deep')).toBeFocused(); await expect(box(page, 'Deep link', 'Root / Child / Deep')).toBeChecked(); expect(errors).toEqual([]);
});

for (const width of [1200, 320]) test(`one reload button sits left of Clear and refreshes folders without clearing drafts at ${width}px`, async ({ browser, env }) => {
  const { page, errors } = await client(browser, env, width); await open(page); await box(page, 'Docs').check(); await expect(page.locator('#bookmark-reload-folders')).toBeEnabled();
  const reload = page.getByRole('button', { name: 'Reload folder', exact: true }); const clear = page.getByRole('button', { name: 'Clear', exact: true });
  await expect(reload).toHaveCount(1); await expect(page.getByRole('button', { name: 'Select none', exact: true })).toHaveCount(0); await expect(page.locator('#bookmark-picker-folders').getByRole('button', { name: /^Reload folder/ })).toHaveCount(0);
  const left = await reload.boundingBox(); const right = await clear.boundingBox(); expect(left.x + left.width).toBeLessThanOrEqual(right.x); expect(left.y).toBe(right.y); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const reads = env.reads.length; await reload.click(); await expect.poll(() => env.reads.length).toBeGreaterThan(reads); await expect(reload).toBeEnabled(); await expect(box(page, 'Docs')).toBeChecked(); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toBeNull();
  await clear.click(); await expect(page.locator('#bookmark-link-picker input:checked')).toHaveCount(0); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toBeNull(); await save(page); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toEqual([]); expect(errors).toEqual([]);
});

test('two browsers share choices while dirty selections and credential drafts retain revision conflicts', async ({ browser, env }) => {
  const a = await client(browser, env); const b = await client(browser, env, 390); await open(a.page); await box(a.page, 'Docs').check(); await save(a.page); await a.page.locator('#close-settings').click();
  await poll(b.page); await expect(b.page.getByRole('link', { name: 'Docs', exact: true })).toBeVisible(); await open(b.page); await box(b.page, 'Same').check(); await b.page.getByLabel('Linkwarden access token', { exact: true }).fill('credential-draft');
  await open(a.page); await a.page.locator('#bookmark-select-none').click(); await save(a.page); await poll(b.page); await expect(box(b.page, 'Same')).toBeChecked(); await expect(b.page.getByLabel('Linkwarden access token', { exact: true })).toHaveValue('credential-draft');
  await b.page.locator('#save-preferences').click(); await expect(b.page.locator('#settings-status')).toContainText('changed in another browser'); await expect(box(b.page, 'Same')).toBeChecked();
  await b.page.locator('#reload-shared-preferences').click(); await expect(box(b.page, 'Same')).not.toBeChecked(); await expect(b.page.getByLabel('Linkwarden access token', { exact: true })).toHaveValue('credential-draft'); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toEqual([]); expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
});

test('moved-link discovery is non-mutating; explicit folder repair has discard, conflict, and cold-start semantics', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await open(page); await box(page, 'Docs').check(); await save(page); const original = env.store.getDashboardPreferences();
  env.move(); await poll(page, 300000); await expect(box(page, 'Docs', 'Other')).toBeChecked(); await expect(page.locator('#bookmark-link-picker input:checked')).toHaveCount(1); expect(env.store.getDashboardPreferences()).toEqual(original);
  const repair = page.getByRole('button', { name: 'Use this folder for Docs: Other', exact: true }); await repair.focus(); await page.keyboard.press('Enter'); await expect(repair).toHaveCount(0); expect(env.store.getDashboardPreferences()).toEqual(original);
  await page.locator('#reload-shared-preferences').click(); await expect(repair).toBeVisible(); await repair.click(); await page.locator('#close-settings').click(); await open(page); await expect(repair).toBeVisible();
  await repair.click(); env.store.saveDashboardPreferences({ ...original.preferences, seconds: !original.preferences.seconds }, original.revision); await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toContainText('changed in another browser'); await expect(repair).toHaveCount(0);
  await page.locator('#reload-shared-preferences').click(); await expect(repair).toBeVisible(); await repair.click(); await save(page); const repaired = env.store.getDashboardPreferences(); expect(repaired.preferences.bookmarkLinkSelections[0].selectionId).toBe(original.preferences.bookmarkLinkSelections[0].selectionId); expect(repaired.preferences.bookmarkLinkSelections[0].collectionSelectionId).not.toBe(original.preferences.bookmarkLinkSelections[0].collectionSelectionId);
  await page.locator('#close-settings').click(); await env.restart(); env.clearReads(); await page.reload(); await expect(page.getByRole('link', { name: 'Docs', exact: true })).toBeVisible(); expect(env.reads).toEqual([4]); expect(errors).toEqual([]);
});

test('transient errors retain selected stale links, missing links stay saved, and source replacement cannot match reused numeric IDs', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await open(page); await box(page, 'Docs').check(); await save(page); await page.locator('#close-settings').click(); const selected = env.store.getDashboardPreferences().preferences.bookmarkLinkSelections;
  env.fail(true); await poll(page, 300000); await expect(page.getByRole('link', { name: 'Docs', exact: true })).toBeVisible(); await expect(page.locator('#bookmark-tree')).toContainText('stale'); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toEqual(selected);
  env.fail(false); env.rename('Renamed Docs'); await poll(page, 300000); await expect(page.getByRole('link', { name: 'Renamed Docs', exact: true })).toBeVisible();
  env.remove(); await poll(page, 300000); await expect(page.locator('#bookmark-tree a')).toHaveCount(0); await expect(page.locator('#bookmarks-status')).toContainText('unavailable or not yet found'); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toEqual(selected);
  env.restore(); await env.replaceSource(); await poll(page); await expect(page.locator('#bookmark-tree a')).toHaveCount(0); await open(page); await expect(page.locator('#bookmark-link-picker input:checked')).toHaveCount(1); await expect(page.locator('#bookmark-link-picker')).toContainText('Unavailable selected link'); await expect(box(page, 'Renamed Docs')).not.toBeChecked(); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toEqual(selected); expect(errors).toEqual([]);
});

test('access denial removes protected labels but leaves opaque choices removable', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await open(page); await box(page, 'Docs').check(); await save(page); env.deny(true); await poll(page, 300000); await expect(page.locator('#bookmark-tree a')).toHaveCount(0); await expect(box(page, 'Docs')).toHaveCount(0); await expect(page.locator('#bookmark-link-picker input:checked')).toHaveCount(1); await page.locator('#bookmark-select-none').click(); await save(page); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toEqual([]); expect(errors).toEqual([]);
});

test('the picker preserves 256 selected identities and refuses a 257th without trimming saved choices', async ({ browser, env }) => {
  env.large(257); const collections = await (await fetch(env.url + '/api/linkwarden/collections')).json(); const folder = collections.collections[0]; const catalog = await (await fetch(`${env.url}/api/bookmarks?collection=${folder.collectionToken}`)).json();
  const selections = catalog.bookmarks.slice(0, 256).map((link) => ({ selectionId: link.selectionId, collectionSelectionId: folder.selectionId })); env.store.initializeDashboardPreferences(normalizeDashboardPreferences({ bookmarkLinkSelections: selections }));
  const { page, errors } = await client(browser, env); await open(page); await expect(page.locator('#bookmark-link-picker input:checked')).toHaveCount(256);
  await page.getByRole('checkbox', { name: /^Catalog 256 ·/ }).click(); await expect(page.getByRole('checkbox', { name: /^Catalog 256 ·/ })).not.toBeChecked(); await expect(page.locator('#bookmark-selection-status')).toContainText('Select at most 256 links'); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toHaveLength(256); await expect(page.locator('#bookmark-tree a')).toHaveCount(256); expect(errors).toEqual([]);
});

test('pending preference saves disable selection and repair without mutating another draft record', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await open(page); await box(page, 'Docs').check(); await save(page); env.move(); await poll(page, 300000);
  const repair = page.getByRole('button', { name: 'Use this folder for Docs: Other', exact: true }); await expect(repair).toBeVisible(); await box(page, 'Same').check();
  let release; const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/dashboard/settings', async (route) => { if (route.request().method() === 'PUT') await gate; await route.continue(); });
  try {
    await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toHaveText('Saving shared preferences…'); await expect(repair).toBeDisabled(); await expect(box(page, 'Docs', 'Other')).toBeDisabled(); await expect(page.locator('#bookmark-select-none')).toBeDisabled(); await expect(page.locator('#bookmark-reload-folders')).toBeDisabled();
    release(); await expect(page.locator('#settings-status')).toHaveText('Preferences saved for all browsers.'); await expect(repair).toBeEnabled(); const choices = env.store.getDashboardPreferences().preferences.bookmarkLinkSelections; expect(choices).toHaveLength(2);
    await repair.click(); expect(env.store.getDashboardPreferences().preferences.bookmarkLinkSelections).toEqual(choices); await save(page); const changed = env.store.getDashboardPreferences().preferences.bookmarkLinkSelections; expect(changed.map((record) => record.selectionId)).toEqual(choices.map((record) => record.selectionId)); expect(changed.filter((record) => choices.find((old) => old.selectionId === record.selectionId).collectionSelectionId !== record.collectionSelectionId)).toHaveLength(1); expect(errors).toEqual([]);
  } finally { release(); }
});

test('bookmark polling pauses while hidden and resumes after persisted-page suspension without erasing drafts', async ({ browser, env }) => {
  const { page, errors } = await client(browser, env); await open(page); await box(page, 'Docs').check(); await save(page); await box(page, 'Same').check(); await page.getByLabel('Linkwarden access token', { exact: true }).fill('still-a-draft');
  const reads = env.reads.length;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }); await poll(page, 300000); expect(env.reads.length).toBe(reads); await expect(box(page, 'Same')).toBeChecked();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); }); await expect.poll(() => env.reads.length).toBeGreaterThan(reads); await expect(page.locator('#bookmark-reload-folders')).toBeEnabled(); await expect(box(page, 'Same')).toBeChecked();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); const suspendedReads = env.reads.length; await poll(page, 300000); expect(env.reads.length).toBe(suspendedReads);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await expect.poll(() => env.reads.length).toBeGreaterThan(suspendedReads); await expect(box(page, 'Same')).toBeChecked(); await expect(page.getByLabel('Linkwarden access token', { exact: true })).toHaveValue('still-a-draft'); await expect(page.locator('#bookmark-tree a')).toHaveCount(1); expect(errors).toEqual([]);
});

for (const width of [1200, 390, 320]) test(`nested duplicate-name selection fits ${width}px and survives mode changes and fullscreen`, async ({ browser, env }) => {
  const { page, errors } = await client(browser, env, width); await open(page); await page.locator('#bookmark-picker-folders summary', { hasText: 'Child' }).click(); await expect(box(page, 'Same', 'Root / Child')).toBeVisible(); await box(page, 'Same', 'Root / Child').check(); await expect(box(page, 'Same', 'Root')).not.toBeChecked(); await save(page); await page.locator('#close-settings').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width); await expect(page.locator('#bookmark-tree a')).toHaveCount(1); await expect(page.locator('#bookmark-tree details, #bookmark-tree summary')).toHaveCount(0); await expect(page.getByRole('link', { name: 'Same', exact: true })).toBeVisible();
  await open(page); await expect(page.locator('#bookmark-picker-folders details').filter({ has: box(page, 'Same', 'Root / Child') }).last()).toContainText('Same'); await page.getByRole('tab', { name: 'General', exact: true }).click(); await page.getByLabel('Hide bookmarks in fullscreen', { exact: true }).check(); await save(page); await page.locator('#close-settings').click(); await expect(page.locator('#bookmark-tree a')).toHaveCount(1);
  await page.locator('#fullscreen').click(); await expect(page.locator('#bookmarks')).toBeHidden(); await page.evaluate(() => document.exitFullscreen()); await expect(page.locator('#bookmarks')).toBeVisible(); await expect(page.locator('#bookmark-tree a')).toHaveCount(1); expect(errors).toEqual([]);
});
