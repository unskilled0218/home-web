import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { decryptApiKey, encryptApiKey, encryptionKey } from '../src/linkwarden-crypto.js';
import { buildCollectionTree, createLinkwardenClient, normalizeBookmarks, normalizeCollections, normalizeLinkwardenCredentials } from '../src/linkwarden.js';

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
  legacy.exec('CREATE TABLE linkwarden_config (id INTEGER PRIMARY KEY, base_url TEXT NOT NULL, username TEXT, collection_name TEXT, collection_id INTEGER NOT NULL, key_ciphertext TEXT NOT NULL, key_iv TEXT NOT NULL, key_tag TEXT NOT NULL, created_at TEXT, updated_at TEXT)');
  legacy.prepare('INSERT INTO linkwarden_config VALUES (1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run('https://links.example.test', 'musty', 'Reading', 3, 'ciphertext', 'iv', 'tag');
  legacy.close();
  const store = createStore(databasePath);
  const encryptedKey = encryptApiKey('secret-api-key', secret);
  try {
    assert.equal(store.getLinkwarden().username, 'musty');
    assert.deepEqual(store.getLinkwarden().encryptedAccessToken, { ciphertext: 'ciphertext', iv: 'iv', tag: 'tag' });
    store.saveLinkwarden({ baseUrl: 'https://links.example.test', username: 'musty', encryptedAccessToken: encryptedKey });
    const saved = store.getLinkwarden();
    assert.deepEqual(Object.keys(saved).sort(), ['baseUrl', 'encryptedAccessToken', 'updatedAt', 'username']);
    assert.equal(saved.encryptedAccessToken.ciphertext.includes('secret-api-key'), false);
    const inspector = new DatabaseSync(databasePath);
    const columns = new Set(inspector.prepare('PRAGMA table_info(linkwarden_config)').all().map((column) => column.name));
    inspector.close();
    assert.equal(columns.has('collection_id'), false);
    assert.equal(columns.has('collection_name'), false);
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

test('normalizes collections and builds a deterministic tree with safe roots', () => {
  const collections = normalizeCollections({ response: [
    { id: 2, name: ' Child ', parentId: 1 },
    { id: 1, name: 'Root' },
    { id: 3, name: 'Orphan', parentId: 99 },
    { id: 4, name: 'Cycle A', parentId: 5 },
    { id: 5, name: 'Cycle B', parent: { id: 4 } },
    { id: 1, name: 'Duplicate' },
    { id: 'bad', name: 'Invalid' }
  ] });
  assert.deepEqual(buildCollectionTree(collections), [
    { id: 4, name: 'Cycle A', parentId: null, children: [] },
    { id: 5, name: 'Cycle B', parentId: null, children: [] },
    { id: 3, name: 'Orphan', parentId: null, children: [] },
    { id: 1, name: 'Root', parentId: null, children: [{ id: 2, name: 'Child', parentId: 1, children: [] }] }
  ]);
  assert.throws(() => normalizeCollections({ response: {} }), /invalid collection list/);
});

test('preserves Linkwarden response size, timeout, and pagination-origin protections', async () => {
  const oversized = createLinkwardenClient({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '1000001' } }) });
  await assert.rejects(oversized.listCollections({ baseUrl: 'https://links.example.test', accessToken: 'token' }), /too large/);

  const timeout = createLinkwardenClient({ timeoutMs: 1, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  await assert.rejects(timeout.listCollections({ baseUrl: 'https://links.example.test', accessToken: 'token' }), /abort|timeout/i);

  const invalidPagination = createLinkwardenClient({ fetchImpl: async () => Response.json({ response: [], next: 'https://outside.example.test/page/2' }) });
  await assert.rejects(invalidPagination.test({ baseUrl: 'https://links.example.test', collectionId: 1, accessToken: 'token' }), /invalid pagination link/);
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

test('keeps cache and stale fallback isolated by collection', async () => {
  let offline = false;
  const client = createLinkwardenClient({ cacheSeconds: 0, fetchImpl: async (url) => {
    if (offline) throw new Error('offline');
    const collectionId = Number(/collections\/(\d+)/.exec(url)[1]);
    return Response.json({ response: [{ id: collectionId, name: `Collection ${collectionId}`, url: `https://${collectionId}.example.test` }] });
  } });
  const common = { baseUrl: 'https://links.example.test', accessToken: 'token' };
  await client.getBookmarks({ ...common, collectionId: 1 });
  await client.getBookmarks({ ...common, collectionId: 2 });
  offline = true;
  assert.deepEqual(await client.getBookmarks({ ...common, collectionId: 1 }, { force: true }), { bookmarks: [{ id: 1, name: 'Collection 1', url: 'https://1.example.test/' }], stale: true });
  assert.deepEqual(await client.getBookmarks({ ...common, collectionId: 2 }, { force: true }), { bookmarks: [{ id: 2, name: 'Collection 2', url: 'https://2.example.test/' }], stale: true });
});

test('does not repopulate a cleared cache from an obsolete request', async () => {
  let resolveRequest;
  let offline = false;
  const client = createLinkwardenClient({ fetchImpl: () => {
    if (offline) throw new Error('offline');
    return new Promise((resolve) => { resolveRequest = resolve; });
  } });
  const settings = { baseUrl: 'https://links.example.test', collectionId: 1, accessToken: 'old-token' };
  const pending = client.getBookmarks(settings);
  client.clearCache();
  resolveRequest(Response.json({ response: [{ id: 1, name: 'Old account', url: 'https://old.example.test' }] }));
  await pending;
  offline = true;
  await assert.rejects(client.getBookmarks(settings, { force: true }), /currently unavailable/);
});

test('lists every valid Linkwarden collection tree with Bearer authorization', async () => {
  const requests = [];
  const client = createLinkwardenClient({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return Response.json({ response: [{ id: 2, name: ' Reading ' }, { id: 3, name: 'Work', parentId: 2 }, { id: 'bad', name: 'Ignored' }] });
  } });
  assert.deepEqual(await client.listCollections({ baseUrl: 'https://links.example.test', accessToken: 'private-token' }), [{ id: 2, name: 'Reading', parentId: null, children: [{ id: 3, name: 'Work', parentId: 2, children: [] }] }]);
  assert.equal(requests[0].url, 'https://links.example.test/api/v1/collections');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-token');
});

test('accepts a self-signed Linkwarden certificate without changing global TLS settings', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lan-wake-self-signed-'));
  const certificatePath = path.join(directory, 'certificate.pem');
  const keyPath = path.join(directory, 'key.pem');
  try {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    } catch (error) {
      context.skip(`OpenSSL is required for the self-signed TLS test: ${error.message}`);
      return;
    }
    const server = https.createServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) }, (request, response) => {
      if (request.url === '/api/v1/collections') { response.writeHead(302, { location: '/collections' }); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"response":[{"id":1,"name":"Self signed"}]}');
    });
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const client = createLinkwardenClient();
    assert.deepEqual(await client.listCollections({ baseUrl: `https://127.0.0.1:${server.address().port}`, accessToken: 'private-token' }), [{ id: 1, name: 'Self signed', parentId: null, children: [] }]);
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
