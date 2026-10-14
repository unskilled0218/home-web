import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';

function rawDevices(count = 4, long = false) {
  return Array.from({ length: count }, (_, index) => ({ deviceId: `private-${index}`, name: long ? `${index} VeryLongSensorName`.repeat(6) : `Device ${index}`, area: 'Office', model: 'Sensor', disabled: index === 3, measurements: index === 2 || index === 3 ? [] : [
    { entityId: `sensor.temperature_${index}`, name: 'Temperature', value: '20.00', unit: '°C', status: 'available', available: true },
    { entityId: `sensor.unknown_${index}`, name: 'Battery', value: null, status: 'unknown', available: false },
    { entityId: `sensor.offline_${index}`, name: 'Humidity', value: null, status: 'unavailable', available: false }
  ] }));
}
const environments = new Set();
test.afterEach(async () => { for (const env of environments) await env.close(); });
async function environment({ count = 4, selected = false, long = false } = {}) {
  const directory = mkdtempSync('/tmp/opencode/dashboard-devices-'); const filename = `${directory}/dashboard.db`; const secret = Buffer.alloc(32, 7).toString('base64');
  let store; let server; let base; let port = 0; let devices = rawDevices(count, long); let failure = false; let wakeFailure = false; let blockWake = false; let releaseWake; let sent = 0; let time = Date.now(); let closed = false;
  const homeAssistant = { clearCache() {}, async listDevices() { if (failure) throw new Error('private failure'); return devices; } };
  async function start() {
    store = createStore(filename);
    server = createDashboardServer({ store, homeAssistant, now: () => time, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret, wakeCooldownSeconds: 20, wolPort: 9 }, wakeExecutor: async ({ markWake, audit }) => {
      sent++; if (blockWake) await new Promise((resolve) => { releaseWake = resolve; });
      if (wakeFailure) { audit('failed', 'fixture'); return { sent: false }; }
      markWake(); audit('sent', 'fixture'); return { sent: true, dispatch: { sent: 1, attempted: 1 } };
    } });
    server.listen(port, '127.0.0.1'); await once(server, 'listening'); port = server.address().port; base = `http://127.0.0.1:${port}`;
  }
  async function stop() { await new Promise((resolve) => server.close(resolve)); store.close(); }
  await start();
  store.saveHomeAssistant({ baseUrl: 'https://home.test', encryptedAccessToken: encryptApiKey('private-token', secret) });
  const pc = store.create({ name: 'Office PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: '192.168.1.42', group: 'Private' });
  const initial = await (await fetch(base + '/api/home-assistant/devices?controls=0')).json(); const ids = initial.devices.map((device) => device.selectionId);
  store.initializeDashboardPreferences(normalizeDashboardPreferences({ homeAssistantDeviceSelections: selected ? ids.slice(0, 256) : [] }));
  const env = { get base() { return base; }, get store() { return store; }, ids, pc, get sent() { return sent; }, setDevices(value) { devices = value; }, fail(value) { failure = value; }, wakeFail(value) { wakeFailure = value; }, blockWake() { blockWake = true; }, releaseWake() { blockWake = false; releaseWake?.(); }, advanceServer(ms) { time += ms; },
    async connect(url) { return fetch(base + '/api/home-assistant', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, accessToken: 'replacement-token' }) }); },
    auditCount() { const db = new DatabaseSync(filename); try { return db.prepare('SELECT COUNT(*) AS count FROM wake_attempts').get().count; } finally { db.close(); } },
    async restart() { await stop(); await start(); },
    async close() { if (closed) return; closed = true; blockWake = false; releaseWake?.(); environments.delete(env); await stop(); rmSync(directory, { recursive: true, force: true }); }
  };
  environments.add(env); return env;
}
async function client(browser, env, width = 1200, height = 850) {
  const context = await browser.newContext({ viewport: { width, height } }); const page = await context.newPage(); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message)); await page.clock.install(); await page.goto(env.base); await expect(page.locator('#settings-status')).toHaveText('Preferences are shared across all browsers.');
  return { page, errors, async close() { expect(errors).toEqual([]); await context.close(); } };
}
async function open(page) { await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Home Assistant', exact: true }).click(); await expect(page.locator('#home-assistant-device-picker input')).not.toHaveCount(0); }
const checkbox = (page, index) => page.getByRole('checkbox', { name: new RegExp(`^Device ${index} ·`) });
async function save(page) { await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toHaveText('Preferences saved for all browsers.'); }
async function poll(page, milliseconds = 5000) { await page.clock.fastForward(milliseconds); }

test('selection is read-only, global, revision-aware and durable across reload and restart', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); const b = await client(browser, env, 390);
  try {
    await expect(a.page.locator('#dashboard-ha-status')).toHaveText('Select Home Assistant devices in Settings.'); await open(a.page);
    await checkbox(a.page, 0).focus(); await a.page.keyboard.press('Space'); await checkbox(a.page, 2).check(); await checkbox(a.page, 3).check(); await save(a.page);
    await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Temperature: 20.00 °C'); await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Battery: Unknown'); await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Humidity: Unavailable');
    await expect(a.page.locator('#dashboard-ha-devices')).toContainText('No supported sensor readings.'); await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Device disabled.'); await expect(a.page.locator('#dashboard-ha-devices button')).toHaveCount(0);
    await expect(a.page.locator('#dashboard-ha-devices')).not.toContainText('Device 1'); await poll(b.page); await expect(b.page.locator('#dashboard-ha-devices')).toContainText('Device 0');
    await a.page.getByRole('tab', { name: 'General', exact: true }).click(); await a.page.getByLabel('Overall scale', { exact: true }).fill('1.2'); await save(a.page);
    expect(env.store.getDashboardPreferences().preferences.homeAssistantDeviceSelections).toEqual([env.ids[0], env.ids[2], env.ids[3]].sort());
    expect(await a.page.evaluate(() => Object.values(localStorage).join(''))).not.toMatch(/private-token|replacement-token|controlToken|private-0/);
    await a.page.reload(); await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Device 0'); await env.restart(); await b.page.reload(); await expect(b.page.locator('#dashboard-ha-devices')).toContainText('Device 0'); expect(env.sent).toBe(0);
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('dirty picker drafts retain focus, reject stale saves and reload without clearing credential drafts', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env); const b = await client(browser, env);
  try {
    await open(a.page); await open(b.page); await checkbox(b.page, 1).check(); await checkbox(b.page, 1).focus(); await b.page.locator('#home-assistant-token').fill('unsent'); await checkbox(b.page, 1).focus();
    await checkbox(a.page, 0).check(); await save(a.page); await poll(b.page, 30000); await expect(checkbox(b.page, 1)).toBeChecked(); await expect(checkbox(b.page, 1)).toBeFocused(); await expect(checkbox(b.page, 0)).not.toBeChecked();
    await b.page.locator('#save-preferences').click(); await expect(b.page.locator('#settings-status')).toContainText('changed in another browser'); await expect(checkbox(b.page, 1)).toBeChecked();
    await b.page.locator('#reload-shared-preferences').click(); await expect(checkbox(b.page, 0)).toBeChecked(); await expect(checkbox(b.page, 1)).not.toBeChecked(); await expect(b.page.locator('#home-assistant-token')).toHaveValue('unsent');
    await checkbox(b.page, 1).check(); await b.page.locator('#close-settings').click(); await open(b.page); await expect(checkbox(b.page, 1)).not.toBeChecked(); await expect(b.page.locator('#home-assistant-token')).toHaveValue('');
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('snapshots retain stale data, missing selections and instance scoping without automatic preference writes', async ({ browser }) => {
  const env = await environment({ selected: true }); const a = await client(browser, env);
  try {
    await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Device 0'); const revision = env.store.getDashboardPreferences().revision;
    env.fail(true); await poll(a.page, 30000); await expect(a.page.locator('#dashboard-ha-status')).toContainText('stale snapshot'); await expect(a.page.locator('#dashboard-ha-devices')).toContainText('20.00 °C');
    env.fail(false); env.setDevices(rawDevices().slice(1)); await poll(a.page, 30000); await expect(a.page.locator('#dashboard-ha-status')).toContainText('1 selected device is missing'); await open(a.page); await expect(a.page.getByRole('checkbox', { name: /Missing selected device/ })).toBeChecked();
    await a.page.locator('#close-settings').click(); await env.connect('https://other.test'); await poll(a.page); await expect(a.page.locator('#dashboard-ha-devices > li')).toHaveCount(0); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    await env.connect('https://home.test'); await poll(a.page); await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Device 1');
    await a.page.request.delete(env.base + '/api/home-assistant'); await poll(a.page); await expect(a.page.locator('#dashboard-ha-status')).toHaveText('Connect Home Assistant in Settings.'); await expect(a.page.locator('#dashboard-ha-devices > li')).toHaveCount(0); expect(env.store.getDashboardPreferences().revision).toBe(revision);
  } finally { await a.close(); await env.close(); }
});

test('Wake rows contain only name and Wake, dispatch once, report cooldown/failure and keep settings independent', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env);
  try {
    const row = a.page.locator('#dashboard-wol-devices > li'); await expect(row).toHaveCount(1);
    expect(await row.evaluate((node) => [...node.children].map((child) => [child.tagName, child.textContent]))).toEqual([['SPAN', 'Office PC'], ['BUTTON', 'Wake']]);
    env.blockWake(); const button = a.page.getByRole('button', { name: 'Wake Office PC', exact: true }); await button.focus(); await a.page.keyboard.press('Enter'); await expect(button).toBeDisabled(); await expect.poll(() => env.sent).toBe(1);
    await poll(a.page); await expect(button).toBeDisabled(); env.releaseWake(); await expect(a.page.locator('#dashboard-wol-action-status')).toContainText('does not confirm'); await expect(button).toBeEnabled(); expect(env.auditCount()).toBe(1);
    await button.click(); await expect(a.page.locator('#dashboard-wol-action-status')).toContainText('Please wait'); expect(env.sent).toBe(1);
    env.advanceServer(25000); env.wakeFail(true); await button.click(); await expect(a.page.locator('#dashboard-wol-action-status')).toContainText('Unable to send'); expect(env.sent).toBe(2);
    await a.page.locator('#open-settings').click(); await a.page.getByRole('tab', { name: 'Wake-on-LAN', exact: true }).click(); await a.page.getByRole('button', { name: 'Edit Office PC', exact: true }).click(); await a.page.locator('#wol-name').fill('Renamed PC'); await a.page.locator('#save-wol-device').click(); await expect(a.page.locator('#dashboard-wol-devices')).toContainText('Renamed PC');
    await a.page.locator('#close-settings').click(); env.store.create({ name: 'Another PC', macAddress: 'AA:BB:CC:DD:EE:00', broadcastAddress: '192.168.1.255', ipAddress: null, group: '' }); await poll(a.page); await expect(a.page.locator('#dashboard-wol-devices > li')).toHaveCount(2); expect(env.sent).toBe(2);
  } finally { env.releaseWake(); await a.close(); await env.close(); }
});

test('hidden device overlays retain snapshots, connections and pending Wake completion', async ({ browser }) => {
  const env = await environment({ selected: true }); const a = await client(browser, env);
  try {
    await expect(a.page.locator('#dashboard-ha-devices')).toContainText('20.00 °C');
    env.blockWake(); await a.page.getByRole('button', { name: 'Wake Office PC', exact: true }).click(); await expect.poll(() => env.sent).toBe(1);
    const before = env.store.getDashboardPreferences().preferences;
    await a.page.locator('#open-settings').click();
    for (const name of ['homeAssistantVisible', 'wolVisible']) await a.page.locator(`[name="${name}"]`).uncheck();
    await save(a.page); await a.page.locator('#close-settings').click(); await expect(a.page.locator('#dashboard-devices')).toBeHidden();
    env.releaseWake(); await expect(a.page.locator('#dashboard-wol-action-status')).toContainText('does not confirm'); expect(env.auditCount()).toBe(1);
    await poll(a.page); await expect(a.page.locator('#dashboard-devices')).toBeHidden();
    await a.page.locator('#open-settings').click();
    for (const name of ['homeAssistantVisible', 'wolVisible']) await a.page.locator(`[name="${name}"]`).check();
    await save(a.page); await a.page.locator('#close-settings').click();
    await expect(a.page.locator('#dashboard-ha-devices')).toContainText('20.00 °C'); await expect(a.page.getByRole('button', { name: 'Wake Office PC', exact: true })).toBeEnabled();
    expect(env.store.getDashboardPreferences().preferences.homeAssistantDeviceSelections).toEqual(before.homeAssistantDeviceSelections); expect(env.sent).toBe(1);
    expect((await (await fetch(env.base + '/api/home-assistant')).json()).homeAssistant.configured).toBe(true);
  } finally { env.releaseWake(); await a.close(); await env.close(); }
});

for (const [width, height] of [[1200, 850], [1200, 420], [900, 850], [390, 850], [320, 600]]) test(`device geometry contains long lists at ${width}×${height} and survives fullscreen hiding`, async ({ browser }) => {
  const env = await environment({ count: 40, selected: true, long: true });
  for (let i = 0; i < 40; i++) env.store.create({ name: `Computer ${i} ` + 'LongName'.repeat(8), macAddress: `02:00:00:00:00:${i.toString(16).padStart(2, '0')}`, broadcastAddress: '192.168.1.255', ipAddress: null, group: '' });
  const saved = env.store.getDashboardPreferences(); env.store.saveDashboardPreferences({ ...saved.preferences, hideBookmarksFullscreen: true, scale: 2 }, saved.revision);
  const a = await client(browser, env, width, height);
  try {
    await expect(a.page.locator('#dashboard-ha-devices > li')).toHaveCount(40); await expect(a.page.locator('#dashboard-wol-devices > li')).toHaveCount(41);
    const info = await a.page.locator('#information').boundingBox(); const ha = await a.page.locator('#dashboard-ha').boundingBox(); const wol = await a.page.locator('#dashboard-wol').boundingBox(); const bookmarks = await a.page.locator('#bookmarks').boundingBox();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width > 1000) {
      expect(info.x + info.width).toBeLessThanOrEqual(ha.x); expect(ha.x + ha.width).toBeLessThanOrEqual(bookmarks.x); expect(Math.abs(ha.height - wol.height)).toBeLessThan(1); expect(wol.y).toBeGreaterThanOrEqual(ha.y + ha.height);
      for (const id of ['dashboard-ha-devices', 'dashboard-wol-devices']) { const dimensions = await a.page.locator(`#${id}`).evaluate((node) => ({ height: node.clientHeight, scroll: node.scrollHeight })); expect(dimensions.scroll).toBeGreaterThan(dimensions.height); }
      await a.page.locator('#dashboard-ha-devices').evaluate((node) => { node.scrollTop = 120; }); await poll(a.page, 30000); expect(await a.page.locator('#dashboard-ha-devices').evaluate((node) => node.scrollTop)).toBe(120);
    } else { expect(ha.y).toBeGreaterThanOrEqual(info.y + info.height); expect(wol.y).toBeGreaterThanOrEqual(ha.y + ha.height); expect(bookmarks.y).toBeGreaterThanOrEqual(wol.y + wol.height); }
    await a.page.locator('#fullscreen').click(); await expect(a.page.locator('#bookmarks')).toBeHidden(); await expect(a.page.locator('#dashboard-ha')).toBeVisible(); await expect(a.page.locator('#dashboard-wol')).toBeVisible(); expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await a.page.evaluate(() => document.exitFullscreen()); await expect(a.page.locator('#bookmarks')).toBeVisible();
  } finally { await a.close(); await env.close(); }
});

test('duplicate names remain independent and the selection limit never silently drops saved devices', async ({ browser }) => {
  const env = await environment({ count: 257, selected: true }); const a = await client(browser, env);
  try {
    const values = rawDevices(257); values[0].name = 'Duplicate'; values[1].name = 'Duplicate'; env.setDevices(values); await poll(a.page, 30000); await open(a.page);
    await expect(a.page.getByRole('checkbox', { name: /^Duplicate ·/ })).toHaveCount(2); await expect(a.page.getByRole('checkbox', { name: /^Duplicate ·/ }).nth(0)).toBeChecked(); await expect(a.page.getByRole('checkbox', { name: /^Duplicate ·/ }).nth(1)).toBeChecked();
    await checkbox(a.page, 256).click(); await expect(checkbox(a.page, 256)).not.toBeChecked(); await expect(a.page.locator('#home-assistant-selection-status')).toContainText('Select at most 256'); await save(a.page); expect(env.store.getDashboardPreferences().preferences.homeAssistantDeviceSelections).toHaveLength(256);
  } finally { await a.close(); await env.close(); }
});

test('device reads pause while hidden and resume after persisted-page suspension without losing selections', async ({ browser }) => {
  const env = await environment({ selected: true }); const a = await client(browser, env); let reads = 0;
  try {
    a.page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/home-assistant/devices') reads++; });
    await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Device 0'); await open(a.page); await checkbox(a.page, 0).uncheck();
    await a.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const before = reads; env.setDevices(rawDevices().map((device) => ({ ...device, name: device.name + ' renamed' }))); await poll(a.page, 60000); expect(reads).toBe(before); await expect(a.page.locator('#dashboard-ha-devices')).not.toContainText('renamed');
    await a.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Device 0 renamed'); await expect(a.page.getByRole('checkbox', { name: /^Device 0 renamed ·/ })).not.toBeChecked();
    await a.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); const suspended = reads; await poll(a.page, 60000); expect(reads).toBe(suspended);
    await a.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await expect.poll(() => reads).toBeGreaterThan(suspended); await expect(a.page.locator('#dashboard-ha-devices')).toContainText('Device 0 renamed');
  } finally { await a.close(); await env.close(); }
});

test('Settings disposal detaches its view without disposing injected controllers or leaving mutation handlers', async ({ browser }) => {
  const env = await environment(); const a = await client(browser, env);
  try {
    const result = await a.page.evaluate(async () => {
      const { createDashboardDevices } = await import('/dashboard-devices.js'); const { createIntegrationSettings } = await import('/dashboard-integration-settings.js');
      const clone = document.getElementById('settings-dialog').cloneNode(true); const doc = { getElementById: (id) => clone.querySelector(`#${id}`), createElement: (tag) => document.createElement(tag) };
      let reads = 0; let mutations = 0; let connected = false; let timerId = 0; const timers = new Map();
      const owner = createDashboardDevices({ schedule: (fn) => { timers.set(++timerId, fn); return timerId; }, cancel: (id) => timers.delete(id), fetchImpl: async (url, options) => {
        if (options.method !== 'GET') mutations++; else reads++;
        return Response.json(url === '/api/home-assistant' ? { homeAssistant: { configured: connected, configurationId: connected ? 'c'.repeat(43) : null, accessTokenPresent: connected, encryptionReady: true, needsReauthentication: false, baseUrl: connected ? 'https://home.test' : '' } } : { devices: [] });
      } });
      const view = createIntegrationSettings({ document: doc, homeAssistant: owner.homeAssistant, wol: owner.wol, confirm: () => true });
      owner.setVisible(true); await owner.homeAssistant.refresh(); await owner.wol.refresh(); view.open(); await owner.homeAssistant.refresh(); view.close();
      const readsBefore = reads; await owner.homeAssistant.refresh(); const continued = reads > readsBefore; const before = doc.getElementById('home-assistant-status').textContent;
      view.dispose(); connected = true; await owner.homeAssistant.refresh();
      const detached = doc.getElementById('home-assistant-status').textContent === before;
      doc.getElementById('home-assistant-url').value = 'https://home.test'; doc.getElementById('home-assistant-token').value = 'draft'; doc.getElementById('home-assistant-connection').dispatchEvent(new Event('submit', { cancelable: true })); await Promise.resolve();
      const alive = owner.homeAssistant.getState().configured; owner.dispose(); view.dispose();
      return { continued, detached, alive, mutations, timers: timers.size };
    });
    expect(result).toEqual({ continued: true, detached: true, alive: true, mutations: 0, timers: 0 });
  } finally { await a.close(); await env.close(); }
});
