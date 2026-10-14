import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookmarkController } from '../public/dashboard-bookmarks.js';
import { MAX_BROWSER_BOOKMARKS, normalizeCollectionTree, normalizeBookmarkLinks } from '../public/bookmark-data.js';
import { normalizeSettings } from '../public/dashboard-helpers.js';
import { selectedBookmarkProjection } from '../public/bookmark-selection-data.js';

const ids = { root: 'r'.repeat(43), child: 'c'.repeat(43), deep: 'd'.repeat(43) };
const source = 'configuration-source-one';
const node = (id, children = [], suffix = 'a') => ({ selectionId: id, name: id, collectionToken: `token-${id}-${suffix}`, children });
const tree = (suffix = 'a') => [node(ids.root, [node(ids.child, [node(ids.deep, [], suffix)], suffix)], suffix)];
const link = (id) => ({ id, selectionId: `b_${String(id).padStart(43, '0')}`, name: `Link ${id}`, url: `https://example.test/${id}` });
const status = (configurationId = source) => ({ configured: configurationId !== null, configurationId, encryptionReady: true, accessTokenPresent: configurationId !== null, baseUrl: 'https://linkwarden.test', username: 'sam' });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };

function setup(t, handler) {
  const tasks = new Map(); const calls = []; let clock = 1000; let id = 0; let latest;
  const client = createBookmarkController({ onChange: (value) => { latest = value; }, now: () => clock, schedule(fn, delay) { tasks.set(++id, { fn, delay }); return id; }, cancel(key) { tasks.delete(key); }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (handler) {
      const result = await handler(url, options);
      if (result) {
        if (!url.startsWith('/api/bookmarks') || !result.ok) return result;
        const data = await result.json(); const token = new URL(url, 'http://fixture').searchParams.get('collection');
        return Response.json({ collectionSelectionId: token.replace(/^token-/, '').replace(/-[ab\d]+$/, ''), ...data });
      }
    }
    if (url === '/api/linkwarden') return Response.json({ linkwarden: status() });
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: source, collections: tree() });
    return Response.json({ configurationId: source, collectionSelectionId: url.includes(ids.deep) ? ids.deep : url.includes(ids.child) ? ids.child : ids.root, bookmarks: [link(url.includes(ids.deep) ? 3 : url.includes(ids.child) ? 2 : 1)], stale: false });
  } });
  t.after(() => client.dispose());
  client.setPickerOpen(true); client.configure([ids.root, ids.child, ids.deep].map((collectionSelectionId, index) => ({ selectionId: link(index + 1).selectionId, collectionSelectionId })));
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

test('picker disclosure loads independently of dashboard profiles, which preserve separate choices', async (t) => {
  const env = setup(t); env.client.configure(null); env.client.setPresentation({ mobile: true }); await env.client.start(); await settle();
  assert.equal(env.latest.folders[ids.root].open, true); assert.equal(env.latest.folders[ids.child].open, false);
  assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(1)]); assert.equal(env.latest.folders[ids.child].loaded, false);
  const initialCalls = env.calls.length; await env.client.start(); assert.equal(env.calls.length, initialCalls, 'starting an initialized owner is idempotent');
  env.client.setFolderOpen(ids.child, true); env.client.setPickerFolderOpen(ids.child, true); await settle(); assert.deepEqual(env.latest.folders[ids.child].bookmarks, [link(2)]); assert.equal(env.latest.folders[ids.deep].open, false);
  env.client.setPresentation({ mobile: false }); env.client.setPickerFolderOpen(ids.deep, true); await settle(); assert.equal(env.latest.folders[ids.deep].loaded, true);
  const count = env.calls.length;
  env.client.setPresentation({ mobile: true }); assert.equal(env.latest.folders[ids.child].open, true); assert.equal(env.latest.folders[ids.deep].open, false);
  env.client.setPresentation({ mobile: true, mode: 'expanded' }); assert.equal(env.latest.folders[ids.deep].open, true);
  env.client.setPresentation({ mobile: true, hidden: true }); env.client.setPresentation({ mobile: true }); await settle();
  assert.equal(env.calls.length, count, 'presentation changes do not refetch fresh folders'); assert.equal(env.tasks.size, 1);
});

test('hidden dashboard does not create catalog demand while opening Settings can load descendants', async (t) => {
  const env = setup(t); env.client.configure(null); env.client.setPresentation({ mobile: true }); await env.client.start(); await settle();
  const calls = env.calls.length; env.client.setPresentation({ mobile: false, hidden: true }); await settle(); assert.equal(env.calls.length, calls);
  env.client.setPickerFolderOpen(ids.child, true); env.client.setPickerFolderOpen(ids.deep, true); await settle(); assert.equal(env.latest.folders[ids.deep].loaded, true);
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

test('no selection creates no folder demand until the independent picker opens; cold selected descendants load while collapsed', async (t) => {
  const env = setup(t); env.client.configure(null); env.client.setPickerOpen(false); env.client.setPresentation({ mobile: true }); await env.client.start(); await settle();
  assert.equal(env.calls.filter((call) => call.url.startsWith('/api/bookmarks')).length, 0); assert.match(env.latest.dashboard.selectionMessage, /Choose links/); assert.deepEqual(env.latest.dashboard.tree, []);
  env.client.configure([]); assert.match(env.latest.dashboard.selectionMessage, /No bookmark links selected/);
  env.client.configure([{ selectionId: link(3).selectionId, collectionSelectionId: ids.deep }]); await settle();
  assert.equal(env.latest.folders[ids.child].loaded, false); assert.equal(env.latest.folders[ids.deep].loaded, true); assert.equal(env.latest.folders[ids.deep].open, false); assert.deepEqual(env.latest.dashboard.folders[ids.deep].bookmarks, [link(3)]);
  assert.equal(env.latest.dashboard.folders[ids.root].bookmarks.length, 0); env.client.setPickerOpen(true); await settle(); assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(1)]); assert.equal(env.latest.dashboard.folders[ids.root].bookmarks.length, 0, 'unselected cached root content is not projected');
});

test('folder-result identity and malformed bookmark identities cannot replace good cached content', async (t) => {
  let wrong = false; const env = setup(t, (url) => wrong && url.includes(ids.root) ? Response.json({ configurationId: source, collectionSelectionId: ids.child, bookmarks: [link(999)] }) : undefined);
  await env.client.start(); await settle(); wrong = true; env.client.retryFolder(ids.root); await settle(); assert.deepEqual(env.latest.folders[ids.root].bookmarks, [link(1)]); assert.match(env.latest.folders[ids.root].error, /identity/);
  assert.throws(() => normalizeBookmarkLinks([{ ...link(1), selectionId: 'raw-id' }]), /identity/);
});

test('a remote selected folder reclaims full unselected catalog capacity and late selected records take priority without reload', async (t) => {
  const collections = Array.from({ length: 8 }, (_, index) => node(String(index).padStart(43, 'x')));
  const rows = (index) => Array.from({ length: 2000 }, (_, offset) => link(index * 2000 + offset + 1));
  const env = setup(t, (url) => {
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: source, collections });
    if (url.startsWith('/api/bookmarks')) { const index = collections.findIndex((collection) => url.includes(collection.selectionId)); return Response.json({ configurationId: source, bookmarks: rows(index) }); }
  });
  env.client.configure(null); await env.client.start(); await settle(); const count = () => Object.values(env.latest.folders).reduce((sum, folder) => sum + folder.bookmarks.length, 0);
  assert.equal(count(), MAX_BROWSER_BOOKMARKS); const chosen = rows(7).at(-1); assert.equal(env.latest.folders[collections[7].selectionId].bookmarks.some((record) => record.selectionId === chosen.selectionId), false);
  env.client.configure([{ selectionId: chosen.selectionId, collectionSelectionId: collections[7].selectionId }]); await settle();
  assert.deepEqual(env.latest.dashboard.folders[collections[7].selectionId].bookmarks, [chosen]); assert.ok(count() <= MAX_BROWSER_BOOKMARKS); assert.ok(Object.values(env.latest.folders).some((folder) => folder.evicted));
  const calls = env.calls.length; env.client.setPresentation({ mobile: true }); env.client.setPickerOpen(false); env.client.setPickerOpen(true); await settle(); assert.equal(env.calls.length, calls, 'eviction does not schedule a catalog refetch loop');
  env.advance(300000); await env.client.refresh(); await settle(); assert.deepEqual(env.latest.dashboard.folders[collections[7].selectionId].bookmarks, [chosen]); assert.ok(count() <= MAX_BROWSER_BOOKMARKS);
  env.client.configure([]); assert.deepEqual(env.latest.dashboard.tree, []); assert.equal(env.latest.selections.length, 0);
});

test('in-flight catalog acceptance uses current selection protection and never reclaims selected capacity', async (t) => {
  let release; const env = setup(t, (url) => url.includes(ids.child) ? new Promise((resolve) => { release = resolve; }) : undefined);
  await env.client.start(); await settle(); env.client.configure([{ selectionId: link(1).selectionId, collectionSelectionId: ids.root }]);
  release(Response.json({ configurationId: source, collectionSelectionId: ids.child, bookmarks: [link(2)] })); await settle();
  assert.deepEqual(env.latest.dashboard.folders[ids.root].bookmarks, [link(1)]); assert.equal(env.latest.dashboard.folders[ids.child], undefined); assert.deepEqual(env.latest.selections, [{ selectionId: link(1).selectionId, collectionSelectionId: ids.root }]);
});

test('projection keeps unavailable choices distinct from setup/empty and never substitutes duplicate labels', () => {
  const state = { tree: tree(), folders: { [ids.root]: { bookmarks: [link(1), { ...link(2), name: 'Link 1' }], attempted: 1 }, [ids.child]: { bookmarks: [], attempted: 1, truncated: true }, [ids.deep]: { bookmarks: [], attempted: null } } };
  const choice = [{ selectionId: link(2).selectionId, collectionSelectionId: ids.root }, { selectionId: link(3).selectionId, collectionSelectionId: ids.child }];
  const projected = selectedBookmarkProjection(state, choice); assert.deepEqual(projected.folders[ids.root].bookmarks.map((value) => value.id), [2]); assert.equal(projected.unresolved.length, 1); assert.match(projected.selectionMessage, /unavailable or not yet found/); assert.equal(projected.tree[0].children.length, 0);
  assert.match(selectedBookmarkProjection(state, null).selectionMessage, /Choose/); assert.match(selectedBookmarkProjection(state, []).selectionMessage, /No bookmark/); assert.equal(choice.length, 2);
});

test('genuinely over-budget selected bytes remain unresolved without exceeding the cache or changing choices', async (t) => {
  const collections = Array.from({ length: 6 }, (_, index) => node(String(index).padStart(43, 'z')));
  const rows = collections.map((_node, index) => ({ ...link(index + 1), url: `https://example.test/${'x'.repeat(1800000)}/${index}` }));
  const env = setup(t, (url) => {
    if (url === '/api/linkwarden/collections') return Response.json({ configurationId: source, collections });
    if (url.startsWith('/api/bookmarks')) { const index = collections.findIndex((collection) => url.includes(collection.selectionId)); return Response.json({ configurationId: source, bookmarks: [rows[index]], truncated: index === 5 }); }
  });
  const selections = collections.map((collection, index) => ({ selectionId: rows[index].selectionId, collectionSelectionId: collection.selectionId })); env.client.configure(selections); env.client.setPickerOpen(false); await env.client.start(); await settle();
  const used = Object.values(env.latest.folders).reduce((total, folder) => total + folder.bytes, 0); assert.ok(used <= 8 * 1024 * 1024); assert.ok(env.latest.dashboard.unresolved.length > 0); assert.equal(env.latest.limit, true); assert.deepEqual(env.latest.selections, selections); assert.match(env.latest.dashboard.selectionMessage, /unavailable or not yet found/);
});

test('one picker reload batches disclosed and selected folders through the bounded queue without changing choices', async (t) => {
  const env = setup(t); env.client.configure(null); await env.client.start(); await settle(); const before = env.calls.length;
  env.client.reloadPickerFolders(); await settle(); assert.equal(env.calls.length, before + 1, 'only the open root is reloaded'); assert.equal(env.latest.selections, null);
  env.client.setPickerFolderOpen(ids.child, true); await settle(); env.client.configure([{ selectionId: link(3).selectionId, collectionSelectionId: ids.deep }]); await settle(); const all = env.calls.length;
  env.client.reloadPickerFolders(); await settle(); assert.equal(env.calls.length, all + 3, 'root, open child and selected deep folder are reloaded'); assert.deepEqual(env.latest.selections, [{ selectionId: link(3).selectionId, collectionSelectionId: ids.deep }]);
  env.client.setPickerOpen(false); const closed = env.calls.length; env.client.reloadPickerFolders(); await settle(); assert.equal(env.calls.length, closed, 'closed picker has no reload demand');
});
