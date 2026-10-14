import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';

test('serialized connection mutations and captured-source checks reject obsolete tree/bookmark results', async (t) => {
  const store = createStore(':memory:'); let releaseConnect; let releaseTree; let releaseBookmarks; let mode = 'good';
  const collections = [{ id: 1, name: 'Root', children: [{ id: 2, name: 'Child', children: [] }] }];
  const client = {
    clearCache() {},
    listCollections: async () => mode === 'connect' ? await new Promise((resolve) => { releaseConnect = () => resolve(collections); }) : mode === 'tree' ? await new Promise((resolve) => { releaseTree = () => resolve(collections); }) : collections,
    getBookmarks: async () => await new Promise((resolve) => { releaseBookmarks = () => resolve({ bookmarks: [{ id: 1, name: 'Old', url: 'https://example.test' }], stale: false }); })
  };
  const server = createDashboardServer({ store, linkwarden: client, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: Buffer.alloc(32, 8).toString('base64') } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const connect = () => fetch(`${base}/api/linkwarden`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://links.test', username: 'sam', accessToken: 'secret' }) });
  const saved = await (await connect()).json(); const token = saved.collections[0].collectionToken;
  const bookmarks = fetch(`${base}/api/bookmarks?collection=${token}`); while (!releaseBookmarks) await new Promise(setImmediate);
  await connect(); releaseBookmarks(); const stale = await bookmarks; assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'LINKWARDEN_CONFIGURATION_CHANGED');
  mode = 'tree'; const tree = fetch(`${base}/api/linkwarden/collections`); while (!releaseTree) await new Promise(setImmediate);
  await fetch(`${base}/api/linkwarden`, { method: 'DELETE' }); releaseTree(); assert.equal((await tree).status, 409);
  mode = 'connect'; const pending = connect(); while (!releaseConnect) await new Promise(setImmediate);
  const removed = fetch(`${base}/api/linkwarden`, { method: 'DELETE' }); releaseConnect(); assert.equal((await pending).status, 200); assert.equal((await removed).status, 204);
  assert.equal((await (await fetch(`${base}/api/linkwarden`)).json()).linkwarden.configured, false);
});

test('bookmark identity survives title, destination, folder and credential changes but isolates sources and accounts', async (t) => {
  const store = createStore(':memory:'); let moved = false; let renamed = false;
  const client = { clearCache() {}, listCollections: async () => [{ id: 1, name: 'Root', children: [] }, { id: 2, name: 'Other', children: [] }], getBookmarks: async () => ({ stale: false, bookmarks: [{ id: 9, name: renamed ? 'Renamed' : 'Docs', url: renamed ? 'https://example.test/new' : 'https://example.test/old' }, { id: 10, name: 'Unsafe', url: 'javascript:alert(1)' }] }) };
  const server = createDashboardServer({ store, linkwarden: client, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: Buffer.alloc(32, 8).toString('base64') } }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { await server.lifecycle.shutdown(); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const connect = async (url = 'https://links.test', username = 'sam') => (await fetch(base + '/api/linkwarden', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, username, accessToken: 'replacement' }) })).json();
  const get = async (connection) => (await fetch(`${base}/api/bookmarks?collection=${connection.collections[moved ? 1 : 0].collectionToken}`)).json();
  const firstConnection = await connect(); const first = await get(firstConnection); assert.equal(first.bookmarks.length, 1); assert.match(first.bookmarks[0].selectionId, /^b_[A-Za-z0-9_-]{43}$/); assert.equal(first.collectionSelectionId, firstConnection.collections[0].selectionId);
  renamed = true; moved = true; const secondConnection = await connect(); const second = await get(secondConnection); assert.notEqual(firstConnection.configurationId, secondConnection.configurationId); assert.equal(second.bookmarks[0].selectionId, first.bookmarks[0].selectionId); assert.equal(second.bookmarks[0].name, 'Renamed'); assert.notEqual(second.collectionSelectionId, first.collectionSelectionId);
  const account = await get(await connect('https://links.test', 'other')); const source = await get(await connect('https://elsewhere.test', 'sam')); assert.notEqual(account.bookmarks[0].selectionId, first.bookmarks[0].selectionId); assert.notEqual(source.bookmarks[0].selectionId, first.bookmarks[0].selectionId);
  assert.equal((await fetch(`${base}/api/bookmarks?collection=${first.bookmarks[0].selectionId}`)).status, 400, 'persistent IDs are not request capabilities');
});
