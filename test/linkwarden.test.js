import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { decryptApiKey, encryptApiKey, encryptionKey } from '../src/linkwarden-crypto.js';
import { buildCollectionTree, createLinkwardenClient, normalizeBookmarks, normalizeCollections, normalizeLinkwardenCredentials } from '../src/linkwarden.js';
import { jsonBytes, MAX_FOLDER_BYTES } from '../public/bookmark-data.js';

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
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-'));
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
  assert.deepEqual(normalizeBookmarks({ data: { links: [
    { id: 1, name: ' Documentation ', url: 'https://example.test/docs', description: ' Useful ', tags: [{ name: 'work' }, 'docs'], favicon: 'https://example.test/icon.svg' },
    { id: 2, name: '', url: 'https://unnamed.example.test/path' },
    { id: 3, name: 'No URL', url: null },
    { id: 2, name: 'Unsafe', url: 'javascript:alert(1)' },
    { id: 'bad', name: 'Invalid', url: 'https://example.test' }
  ], nextCursor: null } }), [
    { id: 1, name: 'Documentation', url: 'https://example.test/docs', description: 'Useful', tags: ['work', 'docs'], favicon: 'https://example.test/icon.svg' },
    { id: 2, name: 'https://unnamed.example.test/path', url: 'https://unnamed.example.test/path' }
  ]);
  assert.deepEqual(normalizeBookmarks({ data: { links: [], nextCursor: null } }), []);
  assert.throws(() => normalizeBookmarks({ data: { links: {} } }), /invalid bookmark list/);
  assert.throws(() => normalizeBookmarks({ data: { links: {} }, response: [] }), /invalid bookmark list/);
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

test('preserves Linkwarden response size, timeout, and cursor protections', async () => {
  const oversized = createLinkwardenClient({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '1000001' } }) });
  await assert.rejects(oversized.listCollections({ baseUrl: 'https://links.example.test', accessToken: 'token' }), /too large/);

  const timeout = createLinkwardenClient({ timeoutMs: 1, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  await assert.rejects(timeout.listCollections({ baseUrl: 'https://links.example.test', accessToken: 'token' }), /abort|timeout/i);

  for (const nextCursor of ['5', true, '', []]) {
    const invalidCursor = createLinkwardenClient({ fetchImpl: async () => Response.json({ data: { links: [], nextCursor } }) });
    await assert.rejects(invalidCursor.test({ baseUrl: 'https://links.example.test', collectionId: 1, accessToken: 'token' }), /invalid bookmark cursor/);
  }

  const repeatedCursor = createLinkwardenClient({ fetchImpl: async () => Response.json({ data: { links: [], nextCursor: 5 } }) });
  await assert.rejects(repeatedCursor.test({ baseUrl: 'https://links.example.test', collectionId: 1, accessToken: 'token' }), /repeated bookmark cursor/);

  let pages = 0;
  const tooManyPages = createLinkwardenClient({ fetchImpl: async () => Response.json({ data: { links: [], nextCursor: ++pages } }) });
  await assert.rejects(tooManyPages.test({ baseUrl: 'https://links.example.test', collectionId: 1, accessToken: 'token' }), /too many bookmark pages/);
});

test('rejects bodyless statuses and malformed redirects without callback exceptions', async () => {
  for (const fixture of [
    { status: 101, headers: { connection: 'upgrade', upgrade: 'test' } },
    { status: 204 },
    { status: 205 },
    { status: 304 },
    { status: 500 },
    { status: 302, location: 'http://[invalid' }
  ]) {
    const server = http.createServer((_request, response) => {
      response.writeHead(fixture.status, { ...fixture.headers, ...(fixture.location && { location: fixture.location }) });
      response.end();
    });
    server.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const client = createLinkwardenClient();
      await assert.rejects(client.listCollections({ baseUrl: `http://127.0.0.1:${server.address().port}`, accessToken: 'token' }));
    } finally { await new Promise((resolve) => server.close(resolve)); }
  }
});

test('uses the search endpoint, authorization, pagination, and cache fallback', async () => {
  const requests = [];
  let fail = false;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (fail) return Response.json({ data: { links: {} } });
    if (!new URL(url).searchParams.has('cursor')) return Response.json({ data: { links: [{ id: 1, name: 'One', url: 'https://one.test' }], nextCursor: 99 } });
    return Response.json({ data: { links: [{ id: 1, name: 'Duplicate', url: 'https://duplicate.test' }, { id: 2, name: 'Two', url: 'https://two.test' }], nextCursor: null } });
  };
  const client = createLinkwardenClient({ fetchImpl, cacheSeconds: 0 });
  const settings = { baseUrl: 'https://links.example.test', collectionId: 7, accessToken: 'private-token' };
  assert.deepEqual(await client.getBookmarks(settings), { bookmarks: [{ id: 1, name: 'One', url: 'https://one.test/' }, { id: 2, name: 'Two', url: 'https://two.test/' }], stale: false });
  assert.equal(requests[0].url, 'https://links.example.test/api/v1/search?collectionId=7');
  assert.equal(requests[1].url, 'https://links.example.test/api/v1/search?collectionId=7&cursor=99');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-token');
  fail = true;
  assert.deepEqual(await client.getBookmarks(settings, { force: true }), { bookmarks: [{ id: 1, name: 'One', url: 'https://one.test/' }, { id: 2, name: 'Two', url: 'https://two.test/' }], stale: true });
});

test('keeps cache and stale fallback isolated by collection', async () => {
  let offline = false;
  const client = createLinkwardenClient({ cacheSeconds: 0, fetchImpl: async (url) => {
    if (offline) throw new Error('offline');
    const collectionId = Number(new URL(url).searchParams.get('collectionId'));
    return Response.json({ data: { links: [{ id: collectionId, name: `Collection ${collectionId}`, url: `https://${collectionId}.example.test` }], nextCursor: null } });
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
  resolveRequest(Response.json({ data: { links: [{ id: 1, name: 'Old account', url: 'https://old.example.test' }], nextCursor: null } }));
  await assert.rejects(pending, { code: 'LINKWARDEN_CONFIGURATION_CHANGED' });
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

test('fresh denied cache entries cannot reappear and allowed siblings remain cached', async () => {
  let denial = false; const calls = [];
  const client = createLinkwardenClient({ fetchImpl: async (url) => {
    const id = Number(new URL(url).searchParams.get('collectionId')); calls.push(id);
    if (id === 1 && denial) return new Response('denied', { status: 403 });
    return Response.json({ data: { links: [{ id, name: `Link ${id}`, url: `https://example.test/${id}` }], nextCursor: null } });
  } });
  const settings = { baseUrl: 'https://links.test', accessToken: 'secret' };
  await client.getBookmarks({ ...settings, collectionId: 1 }); await client.getBookmarks({ ...settings, collectionId: 2 }); denial = true;
  await assert.rejects(client.getBookmarks({ ...settings, collectionId: 1 }, { force: true }), { code: 'LINKWARDEN_ACCESS_DENIED' });
  await assert.rejects(client.getBookmarks({ ...settings, collectionId: 1 }), { code: 'LINKWARDEN_ACCESS_DENIED' });
  await client.getBookmarks({ ...settings, collectionId: 2 }); assert.deepEqual(calls, [1, 2, 1, 1]);
});

test('committed authentication and listing denial retire pending work, but provisional failure preserves cache', async () => {
  let mode = 'good'; let resolveLate; let calls = 0;
  const client = createLinkwardenClient({ fetchImpl: async (url) => {
    calls++;
    if (mode === 'pending' && new URL(url).searchParams.get('collectionId') === '2') return await new Promise((resolve) => { resolveLate = resolve; });
    if (mode === 'denied') return new Response('unauthorized', { status: 401 });
    if (url.endsWith('/collections')) return Response.json({ response: [] });
    return Response.json({ data: { links: [{ id: 1, name: 'Saved', url: 'https://example.test' }], nextCursor: null } });
  } });
  const settings = { baseUrl: 'https://links.test', accessToken: 'token', collectionId: 1 };
  await client.getBookmarks(settings); mode = 'denied';
  await assert.rejects(client.listCollections(settings, { provisional: true }), { code: 'LINKWARDEN_AUTHENTICATION_REQUIRED' });
  const before = calls; await client.getBookmarks(settings); assert.equal(calls, before, 'bad replacement credentials cannot retire the saved cache');
  mode = 'pending'; const pending = client.getBookmarks({ ...settings, collectionId: 2 });
  const rejected = assert.rejects(pending, { code: 'LINKWARDEN_AUTHENTICATION_REQUIRED' });
  await new Promise(setImmediate); mode = 'denied';
  await assert.rejects(client.listCollections(settings), { code: 'LINKWARDEN_AUTHENTICATION_REQUIRED' });
  resolveLate(Response.json({ data: { links: [{ id: 2, name: 'Obsolete', url: 'https://obsolete.test' }] } })); await rejected;
  await assert.rejects(client.getBookmarks(settings), { code: 'LINKWARDEN_AUTHENTICATION_REQUIRED' });
});

test('provider deadlines cover body consumption and cancel early rejected bodies', async () => {
  let canceled = 0;
  const client = createLinkwardenClient({ timeoutMs: 5, fetchImpl: async () => new Response(new ReadableStream({ cancel() { canceled++; } })) });
  await assert.rejects(client.listCollections({ baseUrl: 'https://links.test', accessToken: 'token' }), /timeout/);
  assert.equal(canceled, 1);
  for (const fixture of [{ status: 503 }, { headers: { 'content-length': '1000001' } }]) {
    const early = createLinkwardenClient({ fetchImpl: async () => new Response(new ReadableStream({ cancel() { canceled++; } }), fixture) });
    await assert.rejects(early.listCollections({ baseUrl: 'https://links.test', accessToken: 'token' }));
  }
  assert.equal(canceled, 3, 'all failed requests release unread bodies');
});

test('total pagination deadline, result limits, and bounded cache have observable outcomes', async () => {
  let calls = 0;
  const timed = createLinkwardenClient({ timeoutMs: 1000, collectionTimeoutMs: 5, fetchImpl: async (_url, { signal }) => {
    calls++; if (calls === 1) return Response.json({ data: { links: [], nextCursor: 1 } });
    return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await assert.rejects(timed.test({ baseUrl: 'https://links.test', accessToken: 'token', collectionId: 1 }), /timeout/);
  const many = createLinkwardenClient({ fetchImpl: async () => Response.json({ data: { links: Array.from({ length: 2001 }, (_, i) => ({ id: i + 1, name: 'A', url: 'https://example.test' })), nextCursor: null } }) });
  const limited = await many.getBookmarks({ baseUrl: 'https://links.test', accessToken: 'token', collectionId: 1 });
  assert.equal(limited.bookmarks.length, 2000); assert.equal(limited.truncated, true);
  let page = 0;
  const bytes = createLinkwardenClient({ fetchImpl: async () => { const offset = page++ * 100; return Response.json({ data: { links: Array.from({ length: 100 }, (_, i) => ({ id: offset + i + 1, name: 'x'.repeat(300), description: 'd'.repeat(1000), url: `https://example.test/${'q'.repeat(5000)}` })), nextCursor: page } }); } });
  const prefix = await bytes.getBookmarks({ baseUrl: 'https://links.test', accessToken: 'token', collectionId: 1 });
  assert.equal(prefix.truncated, true); assert.ok(jsonBytes(prefix.bookmarks) <= MAX_FOLDER_BYTES); assert.ok(page < 100);
  const seen = [];
  const lru = createLinkwardenClient({ cacheEntries: 2, fetchImpl: async (url) => { const id = Number(new URL(url).searchParams.get('collectionId')); seen.push(id); return Response.json({ data: { links: [{ id, name: 'Link', url: 'https://example.test' }] } }); } });
  const settings = { baseUrl: 'https://links.test', accessToken: 'token' };
  for (const collectionId of [1, 2, 1, 3, 2]) await lru.getBookmarks({ ...settings, collectionId });
  assert.deepEqual(seen, [1, 2, 3, 2], 'LRU protects the recently read collection');
  let misses = 0;
  const tiny = createLinkwardenClient({ cacheBytes: 1, fetchImpl: async () => { misses++; return Response.json({ data: { links: [] } }); } });
  await tiny.getBookmarks({ ...settings, collectionId: 1 }); await tiny.getBookmarks({ ...settings, collectionId: 1 }); assert.equal(misses, 2);
  assert.throws(() => createLinkwardenClient({ cacheEntries: 0 }));
  assert.throws(() => normalizeCollections({ response: Array.from({ length: 257 }, (_, i) => ({ id: i + 1, name: 'Folder' })) }), { code: 'COLLECTION_LIMIT' });
});

test('requires explicit trust for a private CA and still verifies hostnames', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-self-signed-'));
  const certificatePath = path.join(directory, 'certificate.pem');
  const keyPath = path.join(directory, 'key.pem');
  try {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    } catch (error) {
      context.skip(`OpenSSL is required for the self-signed TLS test: ${error.message}`);
      return;
    }
    const server = https.createServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) }, (request, response) => {
      if (request.url === '/api/v1/collections') { response.writeHead(302, { location: '/collections' }); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"response":[{"id":1,"name":"Self signed"}]}');
    });
    await new Promise((resolve, reject) => server.listen(0, (error) => error ? reject(error) : resolve()));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `https://127.0.0.1:${server.address().port}`;
    await assert.rejects(createLinkwardenClient().listCollections({ baseUrl, accessToken: 'private-token' }), /self-signed|certificate/i);
    const client = createLinkwardenClient({ ca: readFileSync(certificatePath) });
    assert.deepEqual(await client.listCollections({ baseUrl, accessToken: 'private-token' }), [{ id: 1, name: 'Self signed', parentId: null, children: [] }]);
    await assert.rejects(client.listCollections({ baseUrl: `https://localhost:${server.address().port}`, accessToken: 'private-token' }), /hostname|not.*cert|altname/i);
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
