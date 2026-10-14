import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createDashboardServer } from '../src/app.js';
import { createStore } from '../src/db.js';
import { createShutdownCoordinator } from '../src/shutdown.js';
import { deferred, tick, within } from './fixtures/lifecycle.js';

async function listen(t, options = {}) {
  const store = createStore(':memory:'); const server = createDashboardServer({ store, runtimeConfig: { allowedHosts: ['127.0.0.1'], wakeCooldownSeconds: 20, wolPort: 9 }, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { await server.lifecycle.shutdown({ graceMs: 10 }); try { store.close(); } catch { /* May already be closed by the tested coordinator. */ } });
  return { store, server, port: server.address().port };
}

test('incomplete uploads and idle sockets close at grace expiry and release their admitted request work', async (t) => {
  const { server, port } = await listen(t); const socket = net.connect(port, '127.0.0.1'); await once(socket, 'connect');
  socket.on('error', () => {}); socket.write(`POST /api/devices HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
  await tick(); await tick(); assert.equal(server.lifecycle.activeRequests, 1);
  await server.lifecycle.shutdown({ graceMs: 10 }); assert.equal(server.lifecycle.activeRequests, 0); assert.equal(server.listening, false);
  const probe = net.createServer(); probe.listen(port, '127.0.0.1'); await once(probe, 'listening'); await new Promise((resolve) => probe.close(resolve)); socket.destroy();
});

test('destroying a Wake socket does not let SQLite close before the handler finishes its audit', async (t) => {
  const gate = deferred(); const started = deferred(); const order = [];
  t.after(() => gate.resolve());
  const { store, server, port } = await listen(t, { wakeExecutor: async ({ markWake, audit }) => { started.resolve(); await gate.promise; markWake(); audit('sent', 'fixture'); order.push('audit'); return { sent: true, dispatch: { sent: 1, attempted: 1 } }; } });
  const pc = store.create({ name: 'PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: null, group: '' });
  const request = http.request({ host: '127.0.0.1', port, path: `/api/devices/${pc.id}/wake`, method: 'POST' }); request.on('error', () => {}); request.end(); await within(started.promise);
  const coordinator = createShutdownCoordinator({ graceMs: 10, timeoutMs: 1000, report() {} }); coordinator.attach('server', server); coordinator.attach('store', { close() { order.push('store'); store.close(); } }); coordinator.startupFinished();
  const stopped = coordinator.shutdown(); await new Promise((resolve) => setTimeout(resolve, 30)); assert.deepEqual(order, []); assert.equal(server.lifecycle.activeRequests, 1);
  gate.resolve(); assert.equal((await stopped).code, 0); assert.deepEqual(order, ['audit', 'store']);
});

test('queued connection mutations remain tracked through their post-socket-close SQLite writes', async (t) => {
  const gates = [deferred(), deferred()]; const starts = [deferred(), deferred()]; const order = []; let calls = 0;
  t.after(() => { for (const gate of gates) gate.resolve(); });
  const { store, server } = await listen(t, { runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: Buffer.alloc(32, 4).toString('base64') }, homeAssistant: { clearCache() {}, async listDevices() { const index = calls++; starts[index].resolve(); await gates[index].promise; return []; } } });
  const save = store.saveHomeAssistant; store.saveHomeAssistant = (value) => { order.push('save'); return save(value); };
  const responses = [];
  const send = (url) => {
    const request = Readable.from([Buffer.from(JSON.stringify({ url, accessToken: 'fixture-token' }))]); Object.assign(request, { method: 'PUT', url: '/api/home-assistant', headers: { host: '127.0.0.1', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } });
    const response = { destroyed: false, writeHead() {}, end() {} }; responses.push(response); server.emit('request', request, response);
  };
  send('https://first.test'); await within(starts[0].promise); send('https://second.test');
  for (let attempts = 0; server.lifecycle.activeRequests < 2 && attempts < 100; attempts++) await tick(); assert.equal(server.lifecycle.activeRequests, 2);
  const coordinator = createShutdownCoordinator({ graceMs: 10, timeoutMs: 1000, report() {} }); coordinator.attach('server', server); coordinator.attach('store', { close() { order.push('store'); store.close(); } }); coordinator.startupFinished(); const stopped = coordinator.shutdown();
  for (const response of responses) response.destroyed = true;
  await new Promise((resolve) => setTimeout(resolve, 30)); assert.deepEqual(order, []); gates[0].resolve(); await within(starts[1].promise); assert.deepEqual(order, ['save']); gates[1].resolve(); assert.equal((await within(stopped)).code, 0); assert.deepEqual(order, ['save', 'save', 'store']);
});

test('closing admission rejects a late request without touching the store, even before listen', async () => {
  let reads = 0; const server = createDashboardServer({ runtimeConfig: {}, store: { list() { reads++; } } });
  const stopped = server.lifecycle.shutdown({ graceMs: 10 }); const reply = { setHeader() {}, writeHead(code) { this.code = code; }, end(value) { this.body = value; } };
  server.emit('request', { url: '/api/devices', method: 'GET' }, reply); await stopped; assert.equal(reply.code, 503); assert.match(reply.body, /shutting down/); assert.equal(reads, 0);
});

test('a keep-alive response can drain without waiting for the overall shutdown deadline', async (t) => {
  const { server, port } = await listen(t); const agent = new http.Agent({ keepAlive: true }); t.after(() => agent.destroy());
  await new Promise((resolve, reject) => { http.get(`http://127.0.0.1:${port}/api/health`, { agent }, (response) => { response.resume(); response.once('end', resolve); }).on('error', reject); });
  await server.lifecycle.shutdown({ graceMs: 100 }); assert.equal(server.listening, false); assert.equal(server.lifecycle.activeRequests, 0);
});
