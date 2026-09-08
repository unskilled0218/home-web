import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../src/db.js';
import { decryptApiKey, encryptApiKey, encryptionKey } from '../src/linkwarden-crypto.js';
import { createLinkwardenClient, normalizeBookmarks, normalizeLinkwardenConfig } from '../src/linkwarden.js';

const secret = Buffer.alloc(32, 7).toString('base64');

test('encrypts Linkwarden keys with authenticated encryption', () => {
  const encrypted = encryptApiKey('secret-api-key', secret, () => Buffer.alloc(12, 4));
  assert.deepEqual(Object.keys(encrypted).sort(), ['ciphertext', 'iv', 'tag']);
  assert.notEqual(encrypted.ciphertext, 'secret-api-key');
  assert.equal(decryptApiKey(encrypted, secret), 'secret-api-key');
  assert.throws(() => decryptApiKey(encrypted, Buffer.alloc(32, 8).toString('base64')));
  assert.throws(() => encryptionKey('not-a-secret'), /base64/);
});

test('stores Linkwarden configuration without plaintext API key fields', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lan-wake-'));
  const store = createStore(path.join(directory, 'wol.db'));
  const encryptedKey = encryptApiKey('secret-api-key', secret);
  try {
    store.saveLinkwarden({ baseUrl: 'https://links.example.test', collectionId: 3, encryptedKey });
    const saved = store.getLinkwarden();
    assert.deepEqual(Object.keys(saved).sort(), ['baseUrl', 'collectionId', 'encryptedKey', 'updatedAt']);
    assert.equal(saved.encryptedKey.ciphertext.includes('secret-api-key'), false);
    assert.equal(store.removeLinkwarden(), true);
    assert.equal(store.getLinkwarden(), undefined);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('validates Linkwarden settings and retains an existing key when omitted', () => {
  assert.deepEqual(normalizeLinkwardenConfig({ url: 'https://links.example.test/', collectionId: '42', apiKey: ' key ' }), { baseUrl: 'https://links.example.test', collectionId: 42, apiKey: 'key' });
  assert.equal(normalizeLinkwardenConfig({ url: 'https://links.example.test', collectionId: 1, apiKey: '' }, {}).apiKey, null);
  assert.throws(() => normalizeLinkwardenConfig({ url: 'file:///tmp', collectionId: 1, apiKey: 'key' }), /http or https/);
  assert.throws(() => normalizeLinkwardenConfig({ url: 'https://links.example.test', collectionId: 0, apiKey: 'key' }), /positive/);
});

test('normalizes only safe bookmark fields', () => {
  assert.deepEqual(normalizeBookmarks({ data: [
    { id: 1, name: ' Documentation ', url: 'https://example.test/docs', description: ' Useful ', tags: [{ name: 'work' }, 'docs'], favicon: 'https://example.test/icon.svg' },
    { id: 2, name: 'Unsafe', url: 'javascript:alert(1)' },
    { id: 'bad', name: 'Invalid', url: 'https://example.test' }
  ] }), [{ id: 1, name: 'Documentation', url: 'https://example.test/docs', description: 'Useful', tags: ['work', 'docs'], favicon: 'https://example.test/icon.svg' }]);
});

test('uses the collection endpoint, authorization, pagination, and cache fallback', async () => {
  const requests = [];
  let fail = false;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (fail) throw new Error('offline');
    if (url.endsWith('/bookmarks')) return Response.json({ data: [{ id: 1, name: 'One', url: 'https://one.test' }], next: '?page=2' });
    return Response.json({ data: [{ id: 2, name: 'Two', url: 'https://two.test' }] });
  };
  const client = createLinkwardenClient({ fetchImpl, cacheSeconds: 0 });
  const settings = { baseUrl: 'https://links.example.test', collectionId: 7, apiKey: 'private-key' };
  assert.deepEqual(await client.getBookmarks(settings), { bookmarks: [{ id: 1, name: 'One', url: 'https://one.test/' }, { id: 2, name: 'Two', url: 'https://two.test/' }], stale: false });
  assert.equal(requests[0].url, 'https://links.example.test/api/v1/collections/7/bookmarks');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-key');
  fail = true;
  assert.deepEqual(await client.getBookmarks(settings, { force: true }), { bookmarks: [{ id: 1, name: 'One', url: 'https://one.test/' }, { id: 2, name: 'Two', url: 'https://two.test/' }], stale: true });
});
