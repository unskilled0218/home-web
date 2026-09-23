import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionSelectionStore } from '../src/collection-selections.js';

test('prunes expired collection selections and evicts only the oldest active entry', () => {
  let current = 100;
  let sequence = 0;
  const store = createCollectionSelectionStore({ capacity: 2, now: () => current, generateToken: () => `token-${++sequence}` });
  const first = store.issue({ id: 1, fingerprint: 'account', expiresAt: 200 });
  const second = store.issue({ id: 2, fingerprint: 'account', expiresAt: 300 });
  const third = store.issue({ id: 3, fingerprint: 'account', expiresAt: 300 });
  assert.equal(store.size, 2);
  assert.equal(store.resolve(first, 'account'), undefined);
  assert.equal(store.resolve(second, 'account').id, 2);
  assert.equal(store.resolve(third, 'wrong-account'), undefined);

  current = 300;
  const fourth = store.issue({ id: 4, fingerprint: 'account', expiresAt: 400 });
  assert.equal(store.size, 1);
  assert.equal(store.resolve(second, 'account'), undefined);
  assert.equal(store.resolve(fourth, 'account').id, 4);
  store.clear();
  assert.equal(store.size, 0);
});

test('keeps recent tokens valid while a large response crosses capacity', () => {
  let sequence = 0;
  const store = createCollectionSelectionStore({ capacity: 3, now: () => 10, generateToken: () => String(++sequence) });
  const tokens = Array.from({ length: 5 }, (_, index) => store.issue({ id: index + 1, fingerprint: 'account', expiresAt: 100 }));
  assert.equal(store.size, 3);
  assert.equal(store.resolve(tokens[0], 'account'), undefined);
  assert.equal(store.resolve(tokens[1], 'account'), undefined);
  assert.deepEqual(tokens.slice(2).map((token) => store.resolve(token, 'account').id), [3, 4, 5]);
});
