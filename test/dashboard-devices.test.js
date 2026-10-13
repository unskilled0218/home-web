import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardDevices } from '../public/dashboard-devices.js';
import { createHomeAssistantDeviceController, decodeDeviceSnapshot, requestDeviceJson } from '../public/dashboard-home-assistant-devices.js';
import { formatDeviceReading } from '../public/dashboard-device-view.js';
import { createSettingsSync, SHARED_SETTINGS_KEY } from '../public/dashboard-settings-sync.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';

const identity = 'c'.repeat(43); const id = 'd_' + 'a'.repeat(43);
const device = { selectionId: id, name: 'Sensor', area: 'Office', disabled: false, measurements: [{ selectionId: 'r_' + 'b'.repeat(43), name: 'Temperature', value: '20.00', unit: '°C', status: 'available', available: true }], controls: [{ controlToken: 'must-disappear' }] };
const snapshot = (configurationId = identity) => ({ configured: true, configurationId, devices: [device] });
const status = { homeAssistant: { configured: true, configurationId: identity, baseUrl: 'https://home.test', encryptionReady: true, accessTokenPresent: true, needsReauthentication: false } };
const wolDevice = { id: 1, name: 'Office', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', group: '', ipAddress: null };
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };
function clock() { const timers = new Map(); let id = 0; return { timers, schedule(fn, ms) { timers.set(++id, { fn, ms }); return id; }, cancel(id) { timers.delete(id); }, fire(ms) { const found = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(found, `expected ${ms}ms timer`); timers.delete(found[0]); found[1].fn(); } }; }

test('snapshot decoder retains exact numeric text and display fields but rejects malformed data and tokens', () => {
  const value = decodeDeviceSnapshot(snapshot()); assert.equal(value.devices[0].measurements[0].value, '20.00'); assert.doesNotMatch(JSON.stringify(value), /controlToken|must-disappear/);
  assert.equal(formatDeviceReading(value.devices[0].measurements[0]), '20.00 °C');
  assert.equal(formatDeviceReading({ status: 'unavailable' }), 'Unavailable'); assert.equal(formatDeviceReading({ status: 'unknown' }), 'Unknown');
  for (const changed of [{ ...device, selectionId: 'raw' }, { ...device, disabled: 'false' }, { ...device, measurements: [{ ...device.measurements[0], value: 'Infinity' }] }, { ...device, measurements: [{ ...device.measurements[0], value: 20 }] }, { ...device, measurements: [device.measurements[0], device.measurements[0]] }]) assert.throws(() => decodeDeviceSnapshot({ ...snapshot(), devices: [changed] }));
  assert.throws(() => decodeDeviceSnapshot({ ...snapshot(), devices: [device, device] }));
});

test('device reads are demanded, cache-friendly, coalesced, paused and retain stale same-source data', async () => {
  const timer = clock(); let calls = 0; let failure = false;
  const controller = createHomeAssistantDeviceController({ ...timer, now: () => 1000, fetchImpl: async (url) => { assert.equal(url, '/api/home-assistant/devices?controls=0'); calls++; if (failure) throw new Error('private details'); return Response.json(snapshot()); } });
  controller.setVisible(true); controller.configure({ configurationId: identity, configured: true, enabled: false }); await tick(); assert.equal(calls, 0);
  controller.configure({ configurationId: identity, configured: true, enabled: true }); await controller.refresh(); assert.equal(calls, 1); assert.equal(controller.getState().fetchedAt, 1000);
  assert.equal([...timer.timers.values()].filter((timer) => timer.ms === 30000).length, 1);
  failure = true; timer.fire(30000); await tick(); assert.equal(controller.getState().devices[0].name, 'Sensor'); assert.match(controller.getState().error, /unavailable/);
  controller.setVisible(false); assert.equal(timer.timers.size, 0); await controller.refresh(); assert.equal(calls, 2);
  failure = false; controller.setVisible(true); await controller.refresh(); assert.equal(calls, 3);
  controller.configure({ configurationId: identity, configured: true, enabled: false }); assert.equal(timer.timers.size, 0); controller.dispose();
});

test('connection changes and hidden-page generations reject delayed snapshots without retaining old readings', async () => {
  const timer = clock(); const old = deferred(); let calls = 0;
  const controller = createHomeAssistantDeviceController({ ...timer, fetchImpl: () => ++calls === 1 ? old.promise : Promise.resolve(Response.json(snapshot('e'.repeat(43)))) });
  controller.setVisible(true); controller.configure({ configurationId: identity, configured: true, enabled: true }); const first = controller.refresh();
  controller.configure({ configurationId: 'e'.repeat(43), configured: true, enabled: true }); await controller.refresh(); old.resolve(Response.json(snapshot())); await first;
  assert.equal(controller.getState().configurationId, 'e'.repeat(43)); assert.equal(controller.getState().discovered, true);
  controller.configure({ configurationId: null, configured: false, enabled: true }); assert.deepEqual(controller.getState().devices, []); assert.equal(controller.getState().fetchedAt, null); controller.dispose();
});

test('configuration conflicts trigger status discovery without an immediate old-identity retry loop', async () => {
  const timer = clock(); let reads = 0; let statusReads = 0;
  const controller = createHomeAssistantDeviceController({ ...timer, onConfigurationChanged: async () => { statusReads++; }, fetchImpl: async () => { reads++; return Response.json({ code: 'HOME_ASSISTANT_CONFIGURATION_CHANGED', error: 'Changed.' }, { status: 409 }); } });
  controller.setVisible(true); controller.configure({ configurationId: identity, configured: true, enabled: true }); await controller.refresh(); await tick();
  assert.equal(statusReads, 1); assert.equal(reads, 1); assert.deepEqual(controller.getState().devices, []); assert.ok([...timer.timers.values()].some((timer) => timer.ms === 30000)); controller.dispose();
});

test('bounded device response reader rejects both declared and streamed oversized payloads and request deadlines', async () => {
  await assert.rejects(requestDeviceJson('/api', { fetchImpl: async () => new Response('{}', { headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) } }) }), /too large/);
  for (const response of [new Response('{}', { headers: { 'Content-Length': '100' } }), new Response('x'.repeat(100))]) await assert.rejects(requestDeviceJson('/api', { maxBytes: 10, fetchImpl: async () => response }), /too large/);
  const timer = clock(); let calls = 0;
  const pending = requestDeviceJson('/api/devices/1/wake', { ...timer, method: 'POST', fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const rejected = assert.rejects(pending, /outcome is uncertain/); timer.fire(12000); await rejected; assert.equal(calls, 1); assert.equal(timer.timers.size, 0);
});

test('a hidden-page read is invalidated and malformed refreshes cannot replace the last confirmed snapshot', async () => {
  const timer = clock(); const old = deferred(); let calls = 0; let malformed = false;
  const controller = createHomeAssistantDeviceController({ ...timer, fetchImpl: () => ++calls === 1 ? old.promise : Promise.resolve(Response.json(malformed ? { ...snapshot(), devices: [{}] } : snapshot())) });
  controller.setVisible(true); controller.configure({ configurationId: identity, configured: true, enabled: true }); const pending = controller.refresh();
  controller.setVisible(false); old.resolve(Response.json(snapshot())); await pending; assert.equal(controller.getState().discovered, false); assert.deepEqual(controller.getState().devices, []);
  controller.setVisible(true); await controller.refresh(); assert.equal(controller.getState().discovered, true);
  const fetchedAt = controller.getState().fetchedAt; malformed = true; await controller.refresh(); assert.equal(controller.getState().devices[0].selectionId, id); assert.equal(controller.getState().fetchedAt, fetchedAt); assert.match(controller.getState().error, /Invalid Home Assistant/); controller.dispose();
});

test('subscriptions detach independently and controller disposal prevents late observer updates', async () => {
  const timer = clock(); const coordinator = createDashboardDevices({ ...timer, fetchImpl: async (url) => Response.json(url === '/api/home-assistant' ? status : { devices: [] }) });
  let observed = 0; const unsubscribe = coordinator.homeAssistant.subscribe(() => { observed++; });
  coordinator.setVisible(true); await tick(); assert.ok(observed > 0); unsubscribe(); const previous = observed;
  await coordinator.homeAssistant.refresh(); assert.equal(observed, previous); assert.equal(coordinator.homeAssistant.getState().configured, true);
  coordinator.dispose(); assert.equal(timer.timers.size, 0); await coordinator.homeAssistant.refresh(); assert.equal(observed, previous);
});

test('new missing selections request a coalesced snapshot while already known selections need no extra read', async () => {
  const timer = clock(); let reads = 0;
  const coordinator = createDashboardDevices({ ...timer, fetchImpl: async (url) => {
    if (url === '/api/home-assistant') return Response.json(status);
    if (url === '/api/devices') return Response.json({ devices: [] });
    reads++; return Response.json(snapshot());
  } });
  coordinator.configure([id]); coordinator.setVisible(true); await tick(); await tick(); assert.equal(reads, 1);
  coordinator.configure([id]); await tick(); assert.equal(reads, 1);
  coordinator.configure([id, 'd_' + 'e'.repeat(43)]); await tick(); assert.equal(reads, 2); coordinator.dispose();
});

test('coordinator shares status/list polling, supports independent explicit wakes and preserves pending state across suspension', async () => {
  const timer = clock(); const first = deferred(); const second = deferred(); const calls = [];
  const coordinator = createDashboardDevices({ ...timer, fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith('/wake')) return url.includes('/1/') ? first.promise : second.promise;
    return Response.json(url === '/api/home-assistant' ? status : url === '/api/devices' ? { devices: [wolDevice, { ...wolDevice, id: 2, name: 'Second' }] } : snapshot());
  } });
  coordinator.configure([id]); coordinator.setVisible(true); await tick(); await tick();
  assert.equal(coordinator.getState().snapshot.devices.length, 1); assert.equal(calls.filter((call) => call.url === '/api/home-assistant').length, 1);
  const a = coordinator.wake(1); const b = coordinator.wake(2); await coordinator.wake(1); assert.equal(calls.filter((call) => call.method === 'POST').length, 2);
  coordinator.setVisible(false); coordinator.setVisible(true); assert.deepEqual(coordinator.getState().pendingIds, [1, 2]);
  second.resolve(Response.json({ message: 'sent' })); await b; first.resolve(Response.json({ message: 'sent' })); await a;
  assert.match(coordinator.getState().actionMessage, /Second/); assert.deepEqual(coordinator.getState().pendingIds, []);
  coordinator.setPickerOpen(true); coordinator.setPickerOpen(false); assert.equal([...timer.timers.values()].filter((timer) => timer.ms === 5000).length, 1);
  coordinator.dispose(); coordinator.dispose(); assert.equal(timer.timers.size, 0);
});

for (const statusCode of [429, 404, 502]) test(`Wake HTTP ${statusCode} is explicit feedback without a mutation retry`, async () => {
  const timer = clock(); let posts = 0; let gets = 0;
  const coordinator = createDashboardDevices({ ...timer, fetchImpl: async (url, options) => {
    if (options.method === 'POST') { posts++; return Response.json({ error: 'Server action error.' }, { status: statusCode }); }
    if (url === '/api/devices') gets++;
    return Response.json(url === '/api/home-assistant' ? status : { devices: [wolDevice] });
  } });
  coordinator.setVisible(true); await tick(); await coordinator.wake(1); await tick();
  assert.equal(posts, 1); assert.match(coordinator.getState().actionMessage, /Server action error/); assert.equal(gets, statusCode === 404 ? 2 : 1); coordinator.dispose();
});

test('Wake deletion and a failed list refresh never recreate a removed row or reclassify accepted dispatch', async () => {
  const timer = clock(); const action = deferred(); let values = [wolDevice]; let fail = false;
  const coordinator = createDashboardDevices({ ...timer, fetchImpl: async (url, options) => {
    if (options.method === 'POST') return action.promise;
    if (url === '/api/home-assistant') return Response.json(status);
    if (fail) throw new Error('offline');
    return Response.json({ devices: values });
  } });
  coordinator.setVisible(true); await tick(); const wake = coordinator.wake(1); values = []; await coordinator.wol.refresh(); action.resolve(Response.json({ message: 'sent' })); await wake;
  assert.match(coordinator.getState().actionMessage, /packet was sent.*removed/); assert.deepEqual(coordinator.getState().wol.devices, []);
  fail = true; await coordinator.wol.refresh(); assert.match(coordinator.getState().actionMessage, /packet was sent/); coordinator.dispose();
});

test('shared browser-cache compatibility uses exact previous records but cannot initialize authority', () => {
  const previous = normalizeDashboardPreferences({ timezone: 'Asia/Tokyo' }); delete previous.homeAssistantDeviceSelections;
  for (const [value, valid] of [[previous, true], [{ ...previous, scale: '1' }, false], [{ timezone: 'Asia/Tokyo' }, false]]) {
    const sync = createSettingsSync({ storage: { getItem: (key) => key === SHARED_SETTINGS_KEY ? JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: value }) : null }, onSnapshot() {} });
    assert.equal(sync.getState().cache, valid); assert.equal(sync.getState().confirmed, false); assert.deepEqual(sync.getState().snapshot.preferences.homeAssistantDeviceSelections, []); sync.dispose();
  }
});
