import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { decryptApiKey, encryptApiKey, encryptionKey } from '../src/linkwarden-crypto.js';
import { createLinkwardenClient, normalizeBookmarks, normalizeLinkwardenCredentials } from '../src/linkwarden.js';

const secret = Buffer.alloc(32, 7).toString('base64');

test('encrypts Linkwarden keys with authenticated encryption', () => {
  const encrypted = encryptApiKey('secret-api-key', secret, () => Buffer.alloc(12, 4));
  assert.deepEqual(Object.keys(encrypted).sort(), ['ciphertext', 'iv', 'tag']);
  assert.notEqual(encrypted.ciphertext, 'secret-api-key');
  assert.equal(decryptApiKey(encrypted, secret), 'secret-api-key');
  assert.throws(() => decryptApiKey(encrypted, Buffer.alloc(32, 8).toString('base64')));
  assert.throws(() => encryptionKey('not-a-secret'), /base64/);
});

test('migrates and stores Linkwarden configuration without plaintext access-token fields', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lan-wake-'));
  const databasePath = path.join(directory, 'wol.db');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec('CREATE TABLE linkwarden_config (id INTEGER PRIMARY KEY, base_url TEXT NOT NULL, collection_id INTEGER NOT NULL, key_ciphertext TEXT NOT NULL, key_iv TEXT NOT NULL, key_tag TEXT NOT NULL, created_at TEXT, updated_at TEXT)');
  legacy.prepare('INSERT INTO linkwarden_config VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run('https://links.example.test', 3, 'ciphertext', 'iv', 'tag');
  legacy.close();
  const store = createStore(databasePath);
  const encryptedKey = encryptApiKey('secret-api-key', secret);
  try {
    assert.equal(store.getLinkwarden().username, null);
    store.saveLinkwarden({ baseUrl: 'https://links.example.test', username: 'musty', collectionName: 'Reading', collectionId: 3, encryptedAccessToken: encryptedKey });
    const saved = store.getLinkwarden();
    assert.deepEqual(Object.keys(saved).sort(), ['baseUrl', 'collectionId', 'collectionName', 'encryptedAccessToken', 'updatedAt', 'username']);
    assert.equal(saved.encryptedAccessToken.ciphertext.includes('secret-api-key'), false);
    assert.equal(store.removeLinkwarden(), true);
    assert.equal(store.getLinkwarden(), undefined);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('validates Linkwarden username and access token credentials', () => {
  assert.deepEqual(normalizeLinkwardenCredentials({ url: 'https://links.example.test/', username: ' musty ', accessToken: ' token ' }), { baseUrl: 'https://links.example.test', username: 'musty', accessToken: 'token' });
  assert.equal(normalizeLinkwardenCredentials({ url: 'https://links.example.test', username: 'musty', accessToken: '' }, {}).accessToken, null);
  assert.throws(() => normalizeLinkwardenCredentials({ url: 'file:///tmp', username: 'musty', accessToken: 'token' }), /http or https/);
  assert.throws(() => normalizeLinkwardenCredentials({ url: 'https://links.example.test', username: '', accessToken: 'token' }), /Username/);
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
    if (url.endsWith('/bookmarks')) return Response.json({ response: [{ id: 1, name: 'One', url: 'https://one.test' }], next: '?page=2' });
    return Response.json({ response: [{ id: 2, name: 'Two', url: 'https://two.test' }] });
  };
  const client = createLinkwardenClient({ fetchImpl, cacheSeconds: 0 });
  const settings = { baseUrl: 'https://links.example.test', collectionId: 7, accessToken: 'private-token' };
  assert.deepEqual(await client.getBookmarks(settings), { bookmarks: [{ id: 1, name: 'One', url: 'https://one.test/' }, { id: 2, name: 'Two', url: 'https://two.test/' }], stale: false });
  assert.equal(requests[0].url, 'https://links.example.test/api/v1/collections/7/bookmarks');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-token');
  fail = true;
  assert.deepEqual(await client.getBookmarks(settings, { force: true }), { bookmarks: [{ id: 1, name: 'One', url: 'https://one.test/' }, { id: 2, name: 'Two', url: 'https://two.test/' }], stale: true });
});

test('lists every valid Linkwarden collection with Bearer authorization', async () => {
  const requests = [];
  const client = createLinkwardenClient({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return Response.json({ response: [{ id: 2, name: ' Reading ' }, { id: 3, name: 'Work' }, { id: 'bad', name: 'Ignored' }] });
  } });
  assert.deepEqual(await client.listCollections({ baseUrl: 'https://links.example.test', accessToken: 'private-token' }), [{ id: 2, name: 'Reading' }, { id: 3, name: 'Work' }]);
  assert.equal(requests[0].url, 'https://links.example.test/api/v1/collections');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-token');
});
