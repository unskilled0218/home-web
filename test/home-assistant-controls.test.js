import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeAssistantControlStore } from '../src/home-assistant-controls.js';

test('bounds and binds opaque Home Assistant controls', () => {
  let current = 10;
  let sequence = 0;
  const store = createHomeAssistantControlStore({ capacity: 2, now: () => current, generateToken: () => `home-control-token-${++sequence}` });
  const first = store.issue({ entityId: 'light.first', domain: 'light', fingerprint: 'account', expiresAt: 20 });
  const second = store.issue({ entityId: 'switch.second', domain: 'switch', fingerprint: 'account', expiresAt: 30 });
  const third = store.issue({ entityId: 'fan.third', domain: 'fan', fingerprint: 'account', expiresAt: 30 });
  assert.equal(store.size, 2);
  assert.equal(store.resolve(first, 'account'), undefined);
  assert.equal(store.resolve(second, 'different'), undefined);
  assert.equal(store.resolve(second, 'account').entityId, 'switch.second');
  assert.equal(store.resolve(third, 'account').domain, 'fan');
  current = 30;
  assert.equal(store.resolve(second, 'account'), undefined);
  assert.equal(store.size, 1);
  store.clear();
  assert.equal(store.size, 0);
});

test('rejects malformed and colliding generated control tokens', () => {
  const tokens = ['short', 'valid-control-token', 'valid-control-token', 'another-valid-control-token'];
  const store = createHomeAssistantControlStore({ generateToken: () => tokens.shift() });
  const first = store.issue({ fingerprint: 'account', expiresAt: Date.now() + 1_000 });
  const second = store.issue({ fingerprint: 'account', expiresAt: Date.now() + 1_000 });
  assert.equal(first, 'valid-control-token');
  assert.equal(second, 'another-valid-control-token');
  assert.throws(() => createHomeAssistantControlStore({ capacity: 0 }), /positive integer/);
});
