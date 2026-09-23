import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDashboardServer } from '../src/app.js';
import { createStore } from '../src/db.js';

test('covers device CRUD validation and deterministic Wake behavior', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lan-wake-api-'));
  const store = createStore(path.join(directory, 'dashboard.db'));
  let current = 100_000;
  const wakeCalls = [];
  let wakeSucceeds = true;
  const server = createDashboardServer({
    runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: Buffer.alloc(32, 2).toString('base64'), wakeCooldownSeconds: 20, wolPort: 9 },
    store,
    linkwarden: { clearCache() {}, listCollections: async () => [], getBookmarks: async () => ({ bookmarks: [], stale: false }) },
    wakeExecutor: async (options) => { wakeCalls.push(options); return wakeSucceeds ? { sent: true, dispatch: { sent: 6, attempted: 6 } } : { sent: false }; },
    now: () => current
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = async (pathname, { method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? {} : await response.json() };
  };

  const input = { name: 'Office PC', macAddress: 'aa-bb-cc-dd-ee-ff', broadcastAddress: '192.168.1.255', ipAddress: '192.168.1.42', group: 'Office' };
  const created = await api('/api/devices', { method: 'POST', body: input });
  assert.equal(created.status, 201);
  assert.equal(created.body.device.macAddress, 'AA:BB:CC:DD:EE:FF');
  const id = created.body.device.id;
  assert.equal((await api('/api/devices')).body.devices.length, 1);
  assert.equal((await api('/api/devices', { method: 'POST', body: { ...input, padding: 'x'.repeat(17_000) } })).status, 400);
  assert.equal((await api('/api/devices', { method: 'POST', body: input })).status, 409);
  for (const invalid of [
    { ...input, name: '', macAddress: '00:11:22:33:44:51' },
    { ...input, macAddress: 'invalid' },
    { ...input, macAddress: '00:11:22:33:44:53', broadcastAddress: '999.1.1.1' },
    { ...input, macAddress: '00:11:22:33:44:54', ipAddress: 'invalid' }
  ]) assert.equal((await api('/api/devices', { method: 'POST', body: invalid })).status, 400);
  const updated = await api(`/api/devices/${id}`, { method: 'PUT', body: { ...input, name: 'Gaming PC' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.device.name, 'Gaming PC');

  assert.equal((await api('/api/devices/999/wake', { method: 'POST', body: {} })).status, 404);
  const woke = await api(`/api/devices/${id}/wake`, { method: 'POST', body: {} });
  assert.equal(woke.status, 200);
  assert.equal(wakeCalls.length, 1);
  assert.equal(wakeCalls[0].device.id, id);
  assert.equal(wakeCalls[0].port, 9);
  assert.equal((await api(`/api/devices/${id}/wake`, { method: 'POST', body: {} })).status, 429);
  assert.equal(wakeCalls.length, 1);
  current += 20_000;
  wakeSucceeds = false;
  assert.equal((await api(`/api/devices/${id}/wake`, { method: 'POST', body: {} })).status, 502);
  assert.equal(wakeCalls.length, 2);

  assert.equal((await api('/api/devices/999', { method: 'PUT', body: input })).status, 404);
  assert.equal((await api(`/api/devices/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api(`/api/devices/${id}`, { method: 'DELETE' })).status, 404);
});
