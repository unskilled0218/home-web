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
