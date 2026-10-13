import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationPoller } from '../public/dashboard-devices.js';

test('one visible-page timer refreshes controllers independently without waiting for a slow API', async () => {
  const timers = new Map(); let next = 0; const pauses = []; let slow = 0; let healthy = 0; let disposed = 0;
  const controllers = [
    { refresh() { slow++; return new Promise(() => {}); }, setPaused(value) { pauses.push(value); }, dispose() { disposed++; } },
    { async refresh() { healthy++; throw new Error('independent failure'); }, setPaused(value) { pauses.push(value); }, dispose() { disposed++; } }
  ];
  const poller = createIntegrationPoller(controllers, { schedule: (fn, ms) => { assert.equal(ms, 5000); timers.set(++next, fn); return next; }, cancel: (id) => timers.delete(id) });
  poller.setActive(true); poller.setActive(true); assert.equal(timers.size, 1); assert.equal(healthy, 1);
  const [id, tick] = [...timers][0]; timers.delete(id); tick(); await Promise.resolve(); assert.equal(healthy, 2); assert.equal(slow, 2); assert.equal(timers.size, 1);
  poller.setActive(false); assert.equal(timers.size, 0); assert.deepEqual(pauses, [false, false, true, true]);
  poller.setActive(true); assert.equal(healthy, 3); poller.dispose(); assert.equal(timers.size, 0); assert.equal(disposed, 2);
  poller.setActive(true); assert.equal(healthy, 3);
});
