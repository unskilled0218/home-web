import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';

test('shares both layouts across clients, atomically rejects stale saves, and persists on restart', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'home-settings-')); const filename = path.join(directory, 'home.db');
  let store = createStore(filename);
  const server = createDashboardServer({ store, runtimeConfig: { allowedHosts: ['127.0.0.1'] } }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/api/home/settings`;
  const get = async () => (await fetch(url)).json();
  const put = (body, headers = {}) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const initial = await get(); assert.equal(initial.revision, 0); assert.equal(initial.layouts.mobile.length, 6);
  const a = structuredClone(initial); const b = structuredClone(initial); a.layouts.desktop = []; a.preferences.timezone = 'Europe/London'; b.layouts.mobile = [];
  const responses = await Promise.all([put(a), put(b)]); assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const winner = await responses.find((response) => response.status === 200).json(); assert.equal(winner.revision, 1); assert.deepEqual(await get(), winner);
  const next = structuredClone(winner); next.layouts.mobile = []; next.preferences.temperature = 'fahrenheit';
  const updated = await (await put(next)).json(); assert.equal(updated.revision, 2); assert.deepEqual(updated.layouts.desktop, winner.layouts.desktop); assert.deepEqual(updated.layouts.mobile, []);
  assert.equal((await put({ ...updated, version: 3 })).status, 400);
  assert.equal((await put({ ...updated, extra: 'x'.repeat(66000) })).status, 400);
  assert.equal((await put(updated, { origin: 'https://untrusted.test' })).status, 403);
  const badHost = await new Promise((resolve, reject) => { const request = http.get(url, { headers: { host: 'untrusted.test' } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); });
  assert.equal(badHost, 403);
  assert.deepEqual(await get(), updated);
  store.close(); store = createStore(filename); assert.deepEqual(store.getHomeSettings(), updated);
});

test('creates settings on an existing database without replacing devices, and rejects corrupt records', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'home-settings-migration-')); const filename = path.join(directory, 'home.db');
  let store = createStore(filename); const device = store.create({ name: 'PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', group: '', ipAddress: null }); store.close();
  let db = new DatabaseSync(filename); db.exec('DROP TABLE home_settings'); db.close();
  store = createStore(filename); assert.equal(store.get(device.id).name, 'PC'); assert.equal(store.getHomeSettings().revision, 0); store.close();
  db = new DatabaseSync(filename); db.prepare('UPDATE home_settings SET configuration = ?').run('{broken'); db.close();
  store = createStore(filename); assert.throws(() => store.getHomeSettings()); store.close();
  db = new DatabaseSync(filename); assert.equal(db.prepare('SELECT configuration FROM home_settings').get().configuration, '{broken'); db.close(); rmSync(directory, { recursive: true, force: true });
});
