import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookmarkController } from '../public/dashboard-bookmarks.js';
import { MAX_BROWSER_BOOKMARKS, normalizeCollectionTree, normalizeBookmarkLinks } from '../public/bookmark-data.js';
import { normalizeSettings } from '../public/dashboard-helpers.js';

const ids = { root: 'collection-root-0001', child: 'collection-child-001', deep: 'collection-deep-0001' };
const source = 'configuration-source-one';
const node = (id, children = [], suffix = 'a') => ({ selectionId: id, name: id, collectionToken: `token-${id}-${suffix}`, children });
const tree = (suffix = 'a') => [node(ids.root, [node(ids.child, [node(ids.deep, [], suffix)], suffix)], suffix)];
const link = (id) => ({ id, name: `Link ${id}`, url: `https://example.test/${id}` });
const status = (configurationId = source) => ({ configured: configurationId !== null, configurationId, encryptionReady: true, accessTokenPresent: configurationId !== null, baseUrl: 'https://linkwarden.test', username: 'sam' });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };

function setup(t, handler) {
  const tasks = new Map(); const calls = []; let clock = 1000; let id = 0; let latest;
  const client = createBookmarkController({ onChange: (value) => { latest = value; }, now: () => clock, schedule(fn, delay) { tasks.set(++id, { fn, delay }); return id; }, cancel(key) { tasks.delete(key); }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (handler) { const result = await handler(url, options); if (result) return result; }
    if (url === '/api/linkwarden') return Response.json({ linkwarden: status() });
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: source, collections: tree() });
    return Response.json({ configurationId: source, bookmarks: [link(url.includes(ids.deep) ? 3 : url.includes(ids.child) ? 2 : 1)], stale: false });
  } });
  t.after(() => client.dispose());
  return { client, tasks, calls, get latest() { return latest; }, advance(ms) { clock += ms; }, run(delay) { const [key, task] = [...tasks].find(([, value]) => value.delay === delay) ?? []; assert.ok(task, `timer ${delay} exists`); tasks.delete(key); task.fn(); } };
}

test('bookmark preferences default independently and public data rejects malformed hierarchy and unsafe links', () => {
  assert.equal(normalizeSettings().mobileBookmarksMode, 'compact'); assert.equal(normalizeSettings().hideBookmarksFullscreen, false);
  assert.equal(normalizeSettings({ mobileBookmarksMode: 'invalid', hideBookmarksFullscreen: 'true' }).hideBookmarksFullscreen, false);
  assert.equal(normalizeSettings({ mobileBookmarksMode: 'expanded', hideBookmarksFullscreen: true }).mobileBookmarksMode, 'expanded');
  assert.throws(() => normalizeCollectionTree([node(ids.root), node(ids.root)]));
  assert.throws(() => normalizeCollectionTree([node(ids.root, {})]));
  assert.throws(() => normalizeCollectionTree(Array.from({ length: 257 }, (_, i) => node(`collection-${String(i).padStart(8, '0')}`))));
  let nested = node(ids.deep); for (let i = 0; i < 16; i++) nested = node(`collection-${String(i).padStart(8, '0')}`, [nested]);
  assert.throws(() => normalizeCollectionTree([nested]), /16/);
  assert.deepEqual(normalizeBookmarkLinks([link(1), { ...link(2), url: 'javascript:alert(1)' }, link(1)]), [link(1)]);
});

test('compact loads roots only, disclosure opens one level, and profiles preserve independent choices', async (t) => {
  const env = setup(t); env.client.setPresentation({ mobile: true }); await env.client.start(); await settle();
  assert.equal(env.latest.folders[ids.root].open, true); assert.equal(env.latest.folders[ids.child].open, false);
  assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(1)]); assert.equal(env.latest.folders[ids.child].loaded, false);
  const initialCalls = env.calls.length; await env.client.start(); assert.equal(env.calls.length, initialCalls, 'starting an initialized owner is idempotent');
  env.client.setFolderOpen(ids.child, true); await settle(); assert.deepEqual(env.latest.folders[ids.child].bookmarks, [link(2)]); assert.equal(env.latest.folders[ids.deep].open, false);
  env.client.setPresentation({ mobile: false }); await settle(); assert.equal(env.latest.folders[ids.deep].loaded, true);
  const count = env.calls.length;
  env.client.setPresentation({ mobile: true }); assert.equal(env.latest.folders[ids.child].open, true); assert.equal(env.latest.folders[ids.deep].open, false);
  env.client.setPresentation({ mobile: true, mode: 'expanded' }); assert.equal(env.latest.folders[ids.deep].open, true);
  env.client.setPresentation({ mobile: true, hidden: true }); env.client.setPresentation({ mobile: true }); await settle();
  assert.equal(env.calls.length, count, 'presentation changes do not refetch fresh folders'); assert.equal(env.tasks.size, 1);
});

test('hidden expanded presentation does not enqueue unloaded descendants', async (t) => {
  const env = setup(t); env.client.setPresentation({ mobile: true }); await env.client.start(); await settle();
  const calls = env.calls.length; env.client.setPresentation({ mobile: false, hidden: true }); await settle(); assert.equal(env.calls.length, calls);
  env.client.setPresentation({ mobile: false, hidden: false }); await settle(); assert.equal(env.latest.folders[ids.deep].loaded, true);
});

test('folder queue owns at most four requests and coalesces duplicate disclosure', async (t) => {
  const pending = []; const collections = Array.from({ length: 8 }, (_, i) => node(`collection-${String(i).padStart(8, '0')}`));
  const env = setup(t, (url) => {
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: source, collections });
    if (url.startsWith('/api/bookmarks')) return new Promise((resolve) => pending.push(resolve));
  });
  await env.client.start(); await settle(); assert.equal(pending.length, 4);
  for (let i = 0; i < 10; i++) env.client.setPresentation({ mobile: false }); assert.equal(pending.length, 4);
  for (const resolve of pending.slice()) resolve(Response.json({ configurationId: source, bookmarks: [link(1)] }));
  await settle(); assert.equal(pending.length, 8);
  for (const resolve of pending.slice(4)) resolve(Response.json({ configurationId: source, bookmarks: [] })); await settle();
  assert.equal(Object.values(env.latest.folders).filter((folder) => folder.loaded).length, 8); assert.equal(env.tasks.size, 1);
});

test('folder failures preserve siblings and respect retry deadlines without successful data', async (t) => {
  const env = setup(t, (url) => url.includes(ids.child) ? Response.json({ error: 'Child unavailable.' }, { status: 503 }) : undefined);
  await env.client.start(); await settle(); assert.equal(env.latest.folders[ids.child].error, 'Child unavailable.'); assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(1)]);
  const before = env.calls.length;
  env.client.setFolderOpen(ids.child, false); env.client.setFolderOpen(ids.child, true); await settle(); assert.equal(env.calls.length, before);
  env.advance(300000); env.run(300000); await settle(); assert.ok(env.calls.length > before); assert.equal(env.tasks.size, 1);
});

test('expired tokens share one renewal and stable folders retain their successful content', async (t) => {
  let reads = 0; let expired = true;
  const env = setup(t, (url) => {
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: source, collections: tree(reads++ ? 'b' : 'a') });
    if (url.startsWith('/api/bookmarks') && url.endsWith('-a') && expired) return Response.json({ code: 'COLLECTION_SELECTION_EXPIRED', error: 'Expired.' }, { status: 400 });
  });
  await env.client.start(); await settle(); assert.equal(reads, 2); assert.equal(env.latest.folders[ids.root].loaded, true); assert.equal(env.latest.folders[ids.deep].loaded, true);
  assert.equal(env.calls.filter((call) => call.url.endsWith('-b')).length, 3); expired = false;
  const count = env.calls.length; env.client.setPresentation({ mobile: true }); env.client.setPresentation({ mobile: false }); await settle(); assert.equal(env.calls.length, count);
});

test('a second invalid token does not cause an unbounded recovery loop', async (t) => {
  let trees = 0;
  const env = setup(t, (url) => {
    if (url === '/api/linkwarden/collections') { trees++; return Response.json({ configurationId: source, collections: tree(String(trees)) }); }
    if (url.startsWith('/api/bookmarks')) return Response.json({ code: 'COLLECTION_SELECTION_EXPIRED', error: 'Expired again.' }, { status: 400 });
  });
  await env.client.start(); await settle(); assert.equal(trees, 2); assert.equal(env.latest.folders[ids.root].loaded, false); assert.equal(env.tasks.size, 1);
});

test('authentication retirement cannot be lifted by readable same-identity status or late folder results', async (t) => {
  let fail = false; let resolveLate;
  const env = setup(t, (url) => {
    if (fail && url.includes(ids.root)) return Response.json({ code: 'LINKWARDEN_AUTHENTICATION_REQUIRED', error: 'Authenticate again.' }, { status: 401 });
    if (fail && url.includes(ids.child)) return new Promise((resolve) => { resolveLate = resolve; });
  });
  await env.client.start(); await settle(); fail = true; env.advance(300000); await env.client.refresh(); await settle();
  assert.equal(env.latest.needsReauthentication, true); assert.deepEqual(env.latest.tree, []);
  resolveLate?.(Response.json({ configurationId: source, bookmarks: [link(999)] })); await settle();
  await env.client.refresh(); await settle(); assert.deepEqual(env.latest.tree, []); assert.equal(env.latest.needsReauthentication, true);
  await assert.rejects(env.client.connect({ url: 'https://links.test', username: 'sam', accessToken: '' }), /required.*re-authentication/);
});

test('successful mutations adopt identities while failed mutations preserve the snapshot', async (t) => {
  let changed = source; let reject = true;
  const env = setup(t, (url, options) => {
    if (url === '/api/linkwarden' && options.method === 'PUT') {
      if (reject) return Response.json({ error: 'Bad replacement token.' }, { status: 400 });
      changed = 'configuration-source-two'; return Response.json({ linkwarden: status(changed), configurationId: changed, collections: tree() });
    }
    if (url === '/api/linkwarden' && options.method === 'DELETE') { changed = null; return new Response(null, { status: 204 }); }
    if (url === '/api/linkwarden') return Response.json({ linkwarden: status(changed) });
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: changed, collections: tree() });
    if (url.startsWith('/api/bookmarks')) return Response.json({ configurationId: changed, bookmarks: [link(1)] });
  });
  await env.client.start(); await settle();
  await assert.rejects(env.client.connect({ url: 'https://new.test', username: 'other', accessToken: 'secret' }), /Bad replacement/);
  assert.equal(env.latest.configurationId, source); assert.equal(env.latest.folders[ids.root].loaded, true);
  reject = false; await env.client.connect({ url: 'https://linkwarden.test', username: 'sam', accessToken: '' }); await settle();
  assert.equal(env.latest.configurationId, changed); assert.equal(env.latest.mutationPending, false);
  await env.client.disconnect(); await settle(); assert.equal(env.latest.configurationId, null); assert.deepEqual(env.latest.tree, []);
});

test('visibility and disposal reject obsolete status discovery and retain one timer', async (t) => {
  let resolveOld; let first = true;
  const env = setup(t, (url) => { if (url === '/api/linkwarden' && first) { first = false; return new Promise((resolve) => { resolveOld = resolve; }); } });
  const pending = env.client.start(); await settle(); env.client.setVisible(false); env.client.setVisible(true); await settle();
  resolveOld(Response.json({ linkwarden: status('configuration-obsolete-source') })); await pending; await settle();
  assert.equal(env.latest.configurationId, source); assert.equal(env.tasks.size, 1);
  env.client.dispose(); await settle(); assert.equal(env.tasks.size, 0);
});

test('browser link budget is bounded and refreshing accepted content does not double count it', async (t) => {
  const collections = Array.from({ length: 8 }, (_, i) => node(`collection-${String(i).padStart(8, '0')}`));
  const rows = Array.from({ length: 2000 }, (_, i) => link(i + 1));
  const env = setup(t, (url) => url === '/api/linkwarden/collections' ? Response.json({ configurationId: source, collections }) : url.startsWith('/api/bookmarks') ? Response.json({ configurationId: source, bookmarks: rows }) : undefined);
  await env.client.start(); await settle();
  assert.equal(Object.values(env.latest.folders).reduce((sum, folder) => sum + folder.bookmarks.length, 0), MAX_BROWSER_BOOKMARKS); assert.equal(env.latest.limit, true);
  env.advance(300000); await env.client.refresh(); await settle();
  assert.equal(Object.values(env.latest.folders).reduce((sum, folder) => sum + folder.bookmarks.length, 0), MAX_BROWSER_BOOKMARKS);
});

test('folder denial clears only that folder while tree refresh removes deleted nodes and preserves renamed identities', async (t) => {
  let deny = false; let remove = false;
  const env = setup(t, (url) => {
    if (url === '/api/linkwarden/collections' && remove) return Response.json({ configurationId: source, collections: [{ ...node(ids.root), name: 'Renamed root' }] });
    if (url.includes(ids.child) && deny) return Response.json({ code: 'LINKWARDEN_ACCESS_DENIED', error: 'Denied child.' }, { status: 403 });
  });
  await env.client.start(); await settle(); deny = true; env.client.retryFolder(ids.child); await settle();
  assert.deepEqual(env.latest.folders[ids.child].bookmarks, []); assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(1)]);
  remove = true; await env.client.refresh(); await settle();
  assert.deepEqual(Object.keys(env.latest.folders), [ids.root]); assert.equal(env.latest.tree[0].name, 'Renamed root'); assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(1)]);
});

test('authoritative external source adoption rejects delayed old folder data', async (t) => {
  let cfg = source; let resolveOld;
  const env = setup(t, (url) => {
    if (url === '/api/linkwarden') return Response.json({ linkwarden: status(cfg) });
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: cfg, collections: [node(ids.root)] });
    if (cfg === source) return new Promise((resolve) => { resolveOld = resolve; });
    return Response.json({ configurationId: cfg, bookmarks: [link(9)] });
  });
  await env.client.start(); await settle(); cfg = 'configuration-external-new'; await env.client.refresh(); await settle();
  resolveOld(Response.json({ configurationId: source, bookmarks: [link(1)] })); await settle();
  assert.equal(env.latest.configurationId, cfg); assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(9)]); assert.equal(env.tasks.size, 1);
});

test('pending mutations stay owned, competing actions are rejected, and response deadlines stop reads', async (t) => {
  let finish;
  const env = setup(t, (url, options) => url === '/api/linkwarden' && options.method === 'PUT' ? new Promise((resolve) => { finish = () => resolve(Response.json({ linkwarden: status(), configurationId: source, collections: tree() })); }) : undefined);
  await env.client.start(); await settle(); const pending = env.client.connect({ url: 'https://links.test', username: 'sam', accessToken: 'secret' }); await settle();
  assert.equal(env.latest.mutationPending, true); await assert.rejects(env.client.disconnect(), /pending/);
  env.client.setPresentation({ mobile: true }); assert.equal(env.latest.mutationPending, true); finish(); await pending; await settle(); assert.equal(env.latest.mutationPending, false);
  const blocked = setup(t, () => new Promise(() => {})); const request = blocked.client.start(); await settle(); blocked.run(25000); await request; await settle();
  assert.match(blocked.latest.error, /timed out/); assert.equal(blocked.tasks.size, 1);
});

test('mismatched folder sources are never adopted and rediscovery stays bounded', async (t) => {
  const env = setup(t, (url) => url.startsWith('/api/bookmarks') ? Response.json({ configurationId: 'configuration-wrong-source', bookmarks: [link(999)] }) : undefined);
  await env.client.start(); await settle();
  assert.equal(env.latest.configurationId, source); assert.deepEqual(env.latest.tree, []);
  assert.equal(env.calls.filter((call) => call.url === '/api/linkwarden').length, 2); assert.equal(env.tasks.size, 1);
});

test('duplicate folder labels do not merge independent contents and browser byte usage stays bounded', async (t) => {
  const duplicate = setup(t, (url) => url === '/api/linkwarden/collections' ? Response.json({ configurationId: source, collections: [{ ...node(ids.root), name: 'Same' }, { ...node(ids.child), name: 'Same' }] }) : undefined);
  await duplicate.client.start(); await settle(); assert.deepEqual(duplicate.latest.folders[ids.root].bookmarks, [link(1)]); assert.deepEqual(duplicate.latest.folders[ids.child].bookmarks, [link(2)]);
  const collections = Array.from({ length: 8 }, (_, i) => node(`collection-${String(i).padStart(8, '0')}`));
  const rows = Array.from({ length: 300 }, (_, i) => ({ ...link(i + 1), url: `https://example.test/${'x'.repeat(5000)}/${i}` }));
  const bytes = setup(t, (url) => url === '/api/linkwarden/collections' ? Response.json({ configurationId: source, collections }) : url.startsWith('/api/bookmarks') ? Response.json({ configurationId: source, bookmarks: rows }) : undefined);
  await bytes.client.start(); await settle();
  const total = Object.values(bytes.latest.folders).reduce((sum, folder) => sum + folder.bytes, 0);
  assert.ok(total <= 8 * 1024 * 1024); assert.equal(bytes.latest.limit, true);
});
