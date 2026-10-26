import { expect } from '@playwright/test';
import { globalTest as test } from './global-fixtures.js';
import { saveCategory } from './category-settings.js';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';

const device = { name: 'Office PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: '192.168.1.42', group: 'Office' };
const environments = new Set();
test.afterEach(async () => { for (const env of environments) await env.close(); });
async function environment() {
  const directory = mkdtempSync('/tmp/opencode/integration-settings-'); const databasePath = `${directory}/dashboard.db`;
  let store; let server; let port = 0; let base; let failure = false; let blocked = false; let release; let closed = false;
  const secret = Buffer.alloc(32, 9).toString('base64');
  const homeAssistant = { clearCache() {}, async listDevices() { if (blocked) await new Promise((resolve) => { release = resolve; }); if (failure) throw new Error('private failure'); return []; } };
  async function start() {
    store = createStore(databasePath);
    server = createDashboardServer({ store, homeAssistant, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret }, linkwarden: { clearCache() {}, listCollections: async () => [], getBookmarks: async () => ({ bookmarks: [], stale: false }) } });
    server.listen(port, '127.0.0.1'); await once(server, 'listening'); port = server.address().port; base = `http://127.0.0.1:${port}`;
  }
  async function stop() { await new Promise((resolve) => server.close(resolve)); store.close(); }
  await start();
  const env = { get store() { return store; }, get base() { return base; }, fail(value) { failure = value; }, block() { blocked = true; }, release() { blocked = false; release?.(); }, async restart() { await stop(); await start(); },
    auditCount() { const db = new DatabaseSync(databasePath); try { return db.prepare('SELECT COUNT(*) AS count FROM wake_attempts').get().count; } finally { db.close(); } },
    async close() { if (closed) return; closed = true; environments.delete(env); blocked = false; release?.(); await stop(); rmSync(directory, { recursive: true, force: true }); }
  };
  environments.add(env); return env;
}
async function client(browser, env, width = 1200) {
  const context = await browser.newContext({ viewport: { width, height: 850 } }); const page = await context.newPage();
  await page.clock.install(); await page.goto(env.base); await expect(page.locator('#settings-status')).toHaveText('General settings use Global shared values.');
  return { page, close: () => context.close() };
}
async function open(page, name = 'Home Assistant') { await page.locator('#open-settings').click(); await page.getByRole('tab', { name, exact: true }).click(); }
async function fillDevice(page, input = device) { for (const [id, key] of [['wol-name', 'name'], ['wol-mac', 'macAddress'], ['wol-broadcast', 'broadcastAddress'], ['wol-ip', 'ipAddress'], ['wol-group', 'group']]) await page.locator(`#${id}`).fill(input[key] ?? ''); }
async function connect(page, url = 'https://home.test', token = 'private-token') { await page.locator('#home-assistant-url').fill(url); await page.locator('#home-assistant-token').fill(token); await page.locator('#connect-home-assistant').click(); }
async function poll(page) { await page.clock.fastForward(5000); }

test('Home Assistant setup, blank token update, safe reconnect failures, and disconnect persist through restart', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env);
  try {
    const mutations = []; a.page.on('request', (request) => { if (request.method() !== 'GET') mutations.push(new URL(request.url()).pathname); });
    await open(a.page); await expect(a.page.locator('#connect-home-assistant')).toBeEnabled();
    await a.page.locator('#home-assistant-url').fill('https://home.test'); await a.page.locator('#connect-home-assistant').click();
    await expect(a.page.locator('#home-assistant-token')).toBeFocused(); expect(env.store.getHomeAssistant()).toBeUndefined();
    await connect(a.page); await expect(a.page.locator('#home-assistant-settings-status')).toHaveText('Home Assistant connected.'); await expect(a.page.locator('#home-assistant-token')).toHaveValue('');
    await connect(a.page, 'https://home.test:443/', ''); await expect(a.page.locator('#home-assistant-settings-status')).toHaveText('Home Assistant connected.');
    const publicState = await (await a.page.request.get(`${env.base}/api/home-assistant`)).text(); expect(publicState).not.toContain('private-token');
    expect(await a.page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('private-token');
    env.fail(true); await connect(a.page, 'https://changed.test', 'replacement'); await expect(a.page.locator('#home-assistant-settings-status')).toContainText('currently unavailable');
    expect(env.store.getHomeAssistant().baseUrl).toBe('https://home.test'); await expect(a.page.locator('#home-assistant-token')).toHaveValue('replacement'); env.fail(false);
    await env.restart(); await a.page.reload(); await open(a.page); await expect(a.page.locator('#home-assistant-status')).toContainText('https://home.test'); await expect(a.page.locator('#home-assistant-token')).toHaveValue('');
    a.page.once('dialog', (dialog) => dialog.dismiss()); await a.page.locator('#disconnect-home-assistant').click(); expect(env.store.getHomeAssistant()).toBeDefined();
    a.page.once('dialog', (dialog) => dialog.accept()); await a.page.locator('#disconnect-home-assistant').click(); await expect(a.page.locator('#home-assistant-settings-status')).toHaveText('Home Assistant disconnected.');
    expect(env.store.getHomeAssistant()).toBeUndefined(); expect(mutations.some((path) => path.includes('/controls/') || path.endsWith('/wake'))).toBe(false);
  } finally { await a.close(); await env.close(); }
});

test('Wake-on-LAN CRUD retains wake history until confirmed deletion, clears optional fields, and survives restart', async ({ browser }) => {
  const env = await environment(); const saved = env.store.create(device); env.store.markWake(saved.id); env.store.audit(saved.id, 'sent', 'fixture');
  const a = await client(browser, env, 390);
  try {
    await open(a.page, 'Wake-on-LAN'); await expect(a.page.locator('#wol-devices')).toContainText('Office PC');
    await a.page.getByRole('button', { name: 'Edit Office PC', exact: true }).click(); await expect(a.page.locator('#wol-name')).toBeFocused();
    await a.page.locator('#wol-name').fill('Gaming PC'); await a.page.locator('#wol-ip').fill(''); await a.page.locator('#wol-group').fill(''); await a.page.locator('#save-wol-device').click();
    await expect(a.page.locator('#wol-settings-status')).toHaveText('Device saved.'); expect(env.auditCount()).toBe(1); expect(env.store.get(saved.id).lastWakeRequestedAt).not.toBeNull(); expect(env.store.get(saved.id).ipAddress).toBeNull(); expect(env.store.get(saved.id).group).toBe('');
    await fillDevice(a.page); await a.page.locator('#save-wol-device').click(); await expect(a.page.locator('#wol-settings-status')).toContainText('already uses that MAC'); await expect(a.page.locator('#wol-name')).toHaveValue('Office PC');
    await a.page.locator('#wol-mac').fill('00:11:22:33:44:55'); await a.page.locator('#wol-broadcast').fill('999.1.1.1'); await a.page.locator('#save-wol-device').click(); await expect(a.page.locator('#wol-settings-status')).toContainText('valid IPv4');
    await a.page.locator('#wol-broadcast').fill('192.168.1.255'); await a.page.locator('#save-wol-device').click(); await expect(a.page.locator('#wol-settings-status')).toHaveText('Device saved.'); expect(env.store.list()).toHaveLength(2);
    await env.restart(); await a.page.reload(); await open(a.page, 'Wake-on-LAN'); await expect(a.page.locator('#wol-devices li')).toHaveCount(2);
    a.page.once('dialog', (dialog) => { expect(dialog.message()).toContain('wake audit records'); return dialog.dismiss(); }); await a.page.getByRole('button', { name: 'Delete Gaming PC', exact: true }).click(); expect(env.auditCount()).toBe(1);
    a.page.once('dialog', (dialog) => dialog.accept()); await a.page.getByRole('button', { name: 'Delete Gaming PC', exact: true }).click(); await expect(a.page.locator('#wol-settings-status')).toHaveText('Device deleted.'); expect(env.auditCount()).toBe(0);
    await a.page.getByRole('button', { name: 'Edit Office PC', exact: true }).click(); await a.page.locator('#wol-name').fill('Discard'); await a.page.locator('#cancel-wol-edit').click(); await expect(a.page.locator('#save-wol-device')).toHaveText('Add device'); expect(env.store.list()[0].name).toBe('Office PC');
  } finally { await a.close(); await env.close(); }
});

test('isolated clients share configuration while dirty device, token, and preference drafts survive polling', async ({ browser }) => {
  const env = await environment(); env.store.create(device); const a = await client(browser, env); const b = await client(browser, env, 390);
  try {
    await open(a.page); await open(b.page); await b.page.locator('#home-assistant-url').fill('https://draft.test'); await b.page.locator('#home-assistant-token').fill('unsent-secret');
    await connect(a.page); await expect(a.page.locator('#home-assistant-settings-status')).toHaveText('Home Assistant connected.'); await poll(b.page);
    await expect(b.page.locator('#home-assistant-status')).toContainText('https://home.test'); await expect(b.page.locator('#home-assistant-url')).toHaveValue('https://draft.test'); await expect(b.page.locator('#home-assistant-token')).toHaveValue('unsent-secret');
    await b.page.getByRole('tab', { name: 'Time', exact: true }).click(); await b.page.getByLabel('Clock scale', { exact: true }).fill('1.7');
    await b.page.getByRole('tab', { name: 'Wake-on-LAN', exact: true }).click(); await b.page.getByRole('button', { name: 'Edit Office PC', exact: true }).click(); await b.page.locator('#wol-name').fill('My draft');
    env.store.update(env.store.list()[0].id, { ...device, name: 'Remote PC' }); await poll(b.page); await expect(b.page.locator('#wol-devices')).toContainText('Remote PC'); await expect(b.page.locator('#wol-name')).toHaveValue('My draft'); await expect(b.page.locator('#wol-editor-status')).toContainText('Saved values changed');
    await b.page.getByRole('tab', { name: 'Time', exact: true }).click(); await expect(b.page.getByLabel('Clock scale', { exact: true })).toHaveValue('1.7'); await saveCategory(b.page);
    await b.page.getByRole('tab', { name: 'Wake-on-LAN', exact: true }).click(); await expect(b.page.locator('#wol-name')).toHaveValue('My draft');
    env.store.remove(env.store.list()[0].id); await poll(b.page); await expect(b.page.locator('#wol-editor-status')).toContainText('removed in another browser'); await b.page.locator('#save-wol-device').click(); await expect(b.page.locator('#wol-settings-status')).toContainText('removed in another browser'); await expect(b.page.locator('#wol-name')).toHaveValue('My draft'); expect(env.store.list()).toHaveLength(0);
    await b.page.locator('#close-settings').click(); await open(b.page); await expect(b.page.locator('#home-assistant-token')).toHaveValue('');
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('late old-session connection completion keeps drafts and unrelated preference saves available', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env);
  try {
    env.block(); await open(a.page); await expect(a.page.locator('#connect-home-assistant')).toBeEnabled(); await connect(a.page);
    await expect(a.page.locator('#home-assistant-url')).toBeDisabled(); await expect(a.page.locator('#save-preferences')).toBeEnabled();
    await a.page.locator('#close-settings').click(); await open(a.page, 'Wake-on-LAN'); await a.page.locator('#wol-name').fill('New session draft');
    env.release(); await expect(a.page.locator('#home-assistant-url')).toBeEnabled(); await expect(a.page.locator('#home-assistant-settings-status')).toHaveText(''); await expect(a.page.locator('#wol-name')).toHaveValue('New session draft'); await expect(a.page.locator('#home-assistant-token')).toHaveValue('');
    await a.page.getByRole('tab', { name: 'Home Assistant', exact: true }).click(); await expect(a.page.locator('#home-assistant-status')).toContainText('https://home.test');
  } finally { env.release(); await a.close(); await env.close(); }
});

test('one stalled status API does not stall device polling, and closing Settings keeps dashboard reads active', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); let release; let haReads = 0; let wolReads = 0;
  try {
    await a.page.route('**/api/home-assistant', async (route) => { haReads++; await new Promise((resolve) => { release = resolve; }); await route.continue().catch(() => {}); });
    a.page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/devices') wolReads++; });
    await open(a.page, 'Wake-on-LAN'); await expect(a.page.locator('#wol-status')).toHaveText('No devices saved.');
    env.store.create(device); await poll(a.page); await expect(a.page.locator('#wol-devices')).toContainText('Office PC'); expect(haReads).toBe(1); expect(wolReads).toBeGreaterThanOrEqual(2);
    await a.page.locator('#close-settings').click(); release?.(); await a.page.unroute('**/api/home-assistant'); const count = wolReads; await poll(a.page); await expect.poll(() => wolReads).toBeGreaterThan(count);
    await open(a.page, 'Wake-on-LAN'); await expect(a.page.locator('#home-assistant-status')).toHaveText('Home Assistant is not connected.'); expect(wolReads).toBeGreaterThan(count);
  } finally { release?.(); await a.close(); await env.close(); }
});

test('desktop and narrow mobile integration tabs retain keyboard navigation and fit the panel', async ({ browser }) => {
  const env = await environment(); env.store.create({ ...device, name: 'A'.repeat(80), group: 'G'.repeat(80) });
  try {
    for (const width of [1200, 390, 320]) {
      const a = await client(browser, env, width);
      try {
        await open(a.page, 'Wake-on-LAN'); await expect(a.page.getByRole('tabpanel').filter({ visible: true })).toHaveCount(1);
        const tab = a.page.getByRole('tab', { name: 'Wake-on-LAN', exact: true }); await tab.focus(); await a.page.keyboard.press('ArrowUp'); await expect(a.page.getByRole('tab', { name: 'Home Assistant', exact: true })).toBeFocused();
        await a.page.keyboard.press('Home'); await expect(a.page.getByRole('tab', { name: 'General', exact: true })).toBeFocused(); await a.page.keyboard.press('ArrowUp'); await expect(a.page.getByRole('tab', { name: 'Images', exact: true })).toBeFocused(); await a.page.keyboard.press('End'); await expect(a.page.getByRole('tab', { name: 'Images', exact: true })).toBeFocused();
        await tab.click(); await a.page.locator('#save-wol-device').click(); await expect(a.page.locator('#wol-name')).toBeFocused();
        const overflow = await a.page.locator('#settings-dialog').evaluate((node) => node.scrollWidth > node.clientWidth); expect(overflow).toBe(false);
        expect(await a.page.locator('.settings-panels').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false);
        await a.page.locator('#close-settings').click(); await expect(a.page.locator('#open-settings')).toBeFocused();
      } finally { await a.close(); }
    }
  } finally { await env.close(); }
});

test('URL eligibility and unreadable credentials give correct token guidance without leaking saved secrets', async ({ browser }) => {
  const env = await environment(); env.store.saveHomeAssistant({ baseUrl: 'https://home.test', encryptedAccessToken: encryptApiKey('unreadable-secret', Buffer.alloc(32, 1).toString('base64')) }); const a = await client(browser, env);
  try {
    await open(a.page); await expect(a.page.locator('#home-assistant-status')).toContainText('needs re-authentication'); await expect(a.page.locator('#home-assistant-token')).toHaveAttribute('required', '');
    await connect(a.page); await expect(a.page.locator('#home-assistant-settings-status')).toHaveText('Home Assistant connected.');
    for (const url of ['https://home.test', 'https://home.test/', 'https://home.test:443/']) { await a.page.locator('#home-assistant-url').fill(url); expect(await a.page.locator('#home-assistant-token').evaluate((node) => node.required)).toBe(false); }
    for (const url of ['ftp://home.test', 'https://user:password@home.test', 'https://home.test/path', 'https://home.test/?query=1', 'https://home.test/#fragment']) {
      await a.page.locator('#home-assistant-url').fill(url); expect(await a.page.locator('#home-assistant-url').evaluate((node) => node.validity.valid)).toBe(false); expect(await a.page.locator('#home-assistant-token').evaluate((node) => node.required)).toBe(true);
      const rejected = await a.page.request.put(`${env.base}/api/home-assistant`, { data: { url, accessToken: 'new-secret' } }); expect(rejected.status()).toBe(400);
    }
    await a.page.locator('#home-assistant-url').fill('https://other.test'); expect(await a.page.locator('#home-assistant-token').evaluate((node) => node.required)).toBe(true);
    await a.page.locator('#connect-home-assistant').click(); await expect(a.page.locator('#home-assistant-token')).toBeFocused(); expect(env.store.getHomeAssistant().baseUrl).toBe('https://home.test');
  } finally { await a.close(); await env.close(); }
});

test('refresh failures retain saved status and visibility/persisted-page resumption uses fresh reads', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); let reads = 0;
  try {
    await open(a.page); await connect(a.page); await expect(a.page.locator('#home-assistant-settings-status')).toHaveText('Home Assistant connected.');
    a.page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/devices') reads++; });
    await a.page.route('**/api/home-assistant', (route) => route.fulfill({ status: 503, json: { error: 'Saved connection unavailable.' } }));
    await poll(a.page); await expect(a.page.locator('#home-assistant-status')).toContainText('https://home.test'); await expect(a.page.locator('#home-assistant-status')).toContainText('Saved connection unavailable.');
    await a.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const before = reads; env.store.create(device); await poll(a.page); expect(reads).toBe(before);
    await a.page.unroute('**/api/home-assistant'); await a.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(a.page.locator('#home-assistant-status')).toHaveText('Saved connection: https://home.test'); await expect(a.page.locator('#wol-devices li')).toHaveCount(1); expect(reads).toBe(before + 1);
    await a.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const suspended = reads; await poll(a.page); expect(reads).toBe(suspended);
    await a.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(() => reads).toBe(suspended + 1); await poll(a.page); await expect.poll(() => reads).toBe(suspended + 2);
  } finally { await a.close(); await env.close(); }
});

test('a delayed device save cannot erase a reopened editor or report an old-session result', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); let release;
  try {
    await a.page.route('**/api/devices', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); await new Promise((resolve) => { release = resolve; }); await route.fulfill({ response });
    });
    await open(a.page, 'Wake-on-LAN'); await fillDevice(a.page); await a.page.locator('#save-wol-device').click(); await expect(a.page.locator('#wol-name')).toBeDisabled();
    await expect.poll(() => Boolean(release)).toBe(true); await a.page.locator('#close-settings').click(); await open(a.page, 'Wake-on-LAN'); release();
    await expect(a.page.locator('#wol-name')).toBeEnabled(); await expect(a.page.locator('#wol-name')).toHaveValue('Office PC'); await expect(a.page.locator('#wol-settings-status')).toHaveText(''); await expect(a.page.locator('#wol-devices li')).toHaveCount(1);
    expect(env.store.list()).toHaveLength(1);
  } finally { release?.(); await a.close(); await env.close(); }
});
