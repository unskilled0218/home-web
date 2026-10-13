import test from 'node:test';
import assert from 'node:assert/strict';
import { createWolController } from '../public/dashboard-wol.js';

const device = { id: 1, name: 'Office', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: null, group: '', lastWakeRequestedAt: null };

test('device CRUD adopts canonical values and sends only configuration fields', async () => {
  let devices = []; const calls = [];
  const controller = createWolController({ fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'DELETE') { devices = []; return new Response(null, { status: 204 }); }
    if (options.method !== 'GET') { devices = [{ ...device, name: JSON.parse(options.body).name }]; return Response.json({ device: devices[0] }, { status: options.method === 'POST' ? 201 : 200 }); }
    return Response.json({ devices });
  } });
  controller.setPaused(false); await controller.refresh(); assert.deepEqual(controller.getState().devices, []);
  await controller.save({ ...device, macAddress: 'aa-bb-cc-dd-ee-ff', lastWakeRequestedAt: 'must-not-send' }); await controller.refresh();
  assert.equal(controller.getState().devices[0].macAddress, device.macAddress);
  assert.deepEqual(Object.keys(JSON.parse(calls.find((call) => call.method === 'POST').body)), ['name', 'macAddress', 'broadcastAddress', 'ipAddress', 'group']);
  await controller.save({ ...device, name: 'Renamed' }, 1); await controller.refresh(); assert.equal(controller.getState().devices[0].name, 'Renamed');
  await controller.remove(1); await controller.refresh(); assert.deepEqual(controller.getState().devices, []); controller.dispose();
});

for (const [code, message] of [[400, 'Invalid IPv4 address.'], [404, 'Device not found.'], [409, 'A device already uses that MAC address.']]) {
  test(`device save retains existing list and exposes HTTP ${code}`, async () => {
    const controller = createWolController({ fetchImpl: async (_url, options) => options.method === 'GET' ? Response.json({ devices: [device] }) : Response.json({ error: message }, { status: code }) });
    controller.setPaused(false); await controller.refresh();
    await assert.rejects(controller.save(device, 1), (error) => error.status === code && error.message === message);
    await controller.refresh(); assert.equal(controller.getState().devices.length, 1); assert.equal(controller.getState().mutationPending, false); controller.dispose();
  });
}

test('a confirmed save remains successful when its follow-up refresh fails', async () => {
  let saved = false;
  const controller = createWolController({ fetchImpl: async (_url, options) => {
    if (options.method === 'POST') { saved = true; return Response.json({ device }); }
    if (saved) throw new Error('offline');
    return Response.json({ devices: [] });
  } });
  controller.setPaused(false); await controller.refresh(); await controller.save(device); await controller.refresh();
  assert.equal(controller.getState().devices[0].id, 1); assert.match(controller.getState().error, /unavailable/); controller.dispose();
});

test('malformed and duplicate-ID lists preserve the last confirmed devices', async () => {
  let response = { devices: [device] };
  const controller = createWolController({ fetchImpl: async () => Response.json(response) });
  controller.setPaused(false); await controller.refresh();
  for (const invalid of [{ devices: null }, { devices: [{}] }, { devices: [device, device] }]) { response = invalid; await controller.refresh(); assert.equal(controller.getState().devices.length, 1); assert.ok(controller.getState().error); }
  controller.dispose();
});

test('duplicate device mutations and old read results cannot undo a confirmed save', async () => {
  let releaseRead; let releaseSave; let reads = 0;
  const controller = createWolController({ fetchImpl: (_url, options) => {
    if (options.method === 'POST') return new Promise((resolve) => { releaseSave = resolve; });
    if (++reads === 1) return new Promise((resolve) => { releaseRead = resolve; });
    return Promise.resolve(Response.json({ devices: [device] }));
  } });
  controller.setPaused(false); const read = controller.refresh(); const saved = controller.save(device);
  await assert.rejects(controller.remove(1), /already pending/); releaseSave(Response.json({ device })); await saved;
  releaseRead(Response.json({ devices: [] })); await read; await controller.refresh(); assert.equal(controller.getState().devices[0].id, device.id); controller.dispose();
});

test('failed deletion retains saved devices and exposes the error', async () => {
  const controller = createWolController({ fetchImpl: async (_url, options) => options.method === 'DELETE' ? Response.json({ error: 'Delete failed.' }, { status: 503 }) : Response.json({ devices: [device] }) });
  controller.setPaused(false); await controller.refresh(); await assert.rejects(controller.remove(1), /Delete failed/); await controller.refresh(); assert.equal(controller.getState().devices[0].id, 1); controller.dispose();
});
