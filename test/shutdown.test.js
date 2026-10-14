import test from 'node:test';
import assert from 'node:assert/strict';
import { createShutdownCoordinator } from '../src/shutdown.js';
import { FakeChild, deferred, fakeClock, tick } from './fixtures/lifecycle.js';

test('shutdown is shared and waits for startup, HTTP and weather before closing SQLite exactly once', async () => {
  const clock = fakeClock(); const http = deferred(); const weather = deferred(); const order = [];
  const shutdown = createShutdownCoordinator({ ...clock, report() {} });
  shutdown.attach('server', { lifecycle: { shutdown() { order.push('http'); return http.promise; } } });
  shutdown.attach('weather', { stop() { order.push('weather'); return weather.promise; } });
  shutdown.attach('store', { close() { order.push('store'); } });
  const first = shutdown.shutdown(); assert.equal(first, shutdown.shutdown()); assert.deepEqual(order, ['http', 'weather']);
  http.resolve(); weather.resolve(); await tick(); assert.deepEqual(order, ['http', 'weather'], 'startup still owns resource creation');
  shutdown.startupFinished(); const result = await first;
  assert.deepEqual(order, ['http', 'weather', 'store']); assert.deepEqual(result, { code: 0, failure: null, forced: false, cleanupSafe: true }); assert.equal(clock.timers.size, 0);
  assert.equal(shutdown.shutdown(), first);
});

test('owned Home Assistant transport disposes after admitted HTTP work and before SQLite closes', async () => {
  const clock = fakeClock(); const http = deferred(); const transport = deferred(); const order = [];
  const lifecycle = createShutdownCoordinator({ ...clock, report() {} });
  lifecycle.attach('server', { lifecycle: { shutdown() { order.push('http'); return http.promise; } } });
  lifecycle.attach('homeAssistant', { dispose() { order.push('transport'); return transport.promise; } });
  lifecycle.attach('store', { close() { order.push('store'); } }); lifecycle.startupFinished();
  const stopping = lifecycle.shutdown(); await tick(); assert.deepEqual(order, ['http']);
  http.resolve(); await tick(); assert.deepEqual(order, ['http', 'transport']);
  transport.resolve(); assert.equal((await stopping).code, 0); assert.deepEqual(order, ['http', 'transport', 'store']);
  const failed = createShutdownCoordinator({ ...clock, report() {} }); let closed = false;
  failed.attach('homeAssistant', { dispose() { throw new Error('fixture'); } }); failed.attach('store', { close() { closed = true; } }); failed.startupFinished();
  assert.equal((await failed.shutdown()).cleanupSafe, false); assert.equal(closed, false);
});

test('startup failure remains nonzero but a safely drained application can recover under its supervisor', async () => {
  const clock = fakeClock(); const messages = []; let closed = 0;
  const shutdown = createShutdownCoordinator({ ...clock, report: (message) => messages.push(message) }); shutdown.attach('store', { close() { closed++; } });
  const stopped = shutdown.fail(new Error('invalid configuration')); shutdown.startupFinished(); const result = await stopped;
  assert.equal(result.code, 1); assert.equal(result.failure, 'application'); assert.equal(result.cleanupSafe, true); assert.equal(closed, 1); assert.match(messages[0], /invalid configuration/);
});

test('cleanup rejection does not skip independent cleanup or close a potentially busy store', async () => {
  const clock = fakeClock(); let http = 0; let store = 0;
  const shutdown = createShutdownCoordinator({ ...clock, report() {} });
  shutdown.attach('weather', { stop() { throw new Error('failed'); } }); shutdown.attach('server', { lifecycle: { async shutdown() { http++; } } }); shutdown.attach('store', { close() { store++; } }); shutdown.startupFinished();
  const result = await shutdown.shutdown(); assert.equal(result.code, 1); assert.equal(result.cleanupSafe, false); assert.equal(http, 1); assert.equal(store, 0);
});

test('forced deadline cannot close SQLite later if stalled work eventually resolves in a test', async () => {
  const clock = fakeClock(); const work = deferred(); let closed = 0;
  const shutdown = createShutdownCoordinator({ ...clock, timeoutMs: 30, report() {} }); shutdown.attach('weather', { stop: () => work.promise }); shutdown.attach('store', { close() { closed++; } }); shutdown.startupFinished();
  const stopped = shutdown.shutdown(); clock.fire(30); const result = await stopped; assert.equal(result.forced, true); assert.equal(result.code, 1); assert.equal(result.cleanupSafe, false);
  work.resolve(); await tick(); assert.equal(closed, 0); assert.equal(clock.timers.size, 0);
});

test('NFS preparation waits for real child exit, not an error event, and denied cleanup is reported', async () => {
  const clock = fakeClock(); const child = new FakeChild(); child.killDenied = true; const notices = []; let store = 0;
  const shutdown = createShutdownCoordinator({ ...clock, timeoutMs: 30, report() {}, notify: (message) => notices.push(message) });
  shutdown.ownPreparation(child); shutdown.attach('store', { close() { store++; } }); shutdown.startupFinished();
  const stopped = shutdown.shutdown(); await tick(); assert.equal(shutdown.getState().pendingPreparations, 1); assert.deepEqual(child.kills, ['SIGTERM']); assert.equal(store, 0);
  clock.fire(30); const result = await stopped; assert.equal(result.forced, true); assert.equal(result.cleanupSafe, false); assert.equal(notices[0].pending, 1);
  child.close(); await tick(); assert.equal(store, 0); assert.equal(notices.at(-1).pending, 0);
});

test('cooperative NFS child exit permits cleanup and spawn failure cannot invent a live preparation', async () => {
  const clock = fakeClock(); const child = new FakeChild(); let store = 0;
  const shutdown = createShutdownCoordinator({ ...clock, report() {} }); shutdown.ownPreparation(child); shutdown.attach('store', { close() { store++; } }); shutdown.startupFinished();
  const stopped = shutdown.shutdown(); child.close(); assert.equal((await stopped).code, 0); assert.equal(store, 1);
  const other = createShutdownCoordinator({ ...clock, report() {} }); const failed = new FakeChild(); failed.pid = undefined; other.ownPreparation(failed); failed.emit('error', new Error('spawn failed')); other.startupFinished(); assert.equal((await other.shutdown()).cleanupSafe, true);
});

test('shutdown during startup never becomes running and resources added before settlement still drain', async () => {
  const clock = fakeClock(); const shutdown = createShutdownCoordinator({ ...clock, report() {} }); const stopped = shutdown.shutdown(); let closed = 0;
  shutdown.attach('store', { close() { closed++; } }); assert.equal(shutdown.stopping, true); shutdown.startupFinished(); await stopped; assert.equal(shutdown.getState().phase, 'stopped'); assert.equal(closed, 1);
});
