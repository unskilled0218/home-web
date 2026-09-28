import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultHomeSettings } from '../public/home-layout.js';
import { createHomeSettingsController } from '../public/home-settings.js';

const response = (value, status = 200) => ({ ok: status === 200, status, json: async () => structuredClone(value) });
function fixture() {
  let remote = defaultHomeSettings(); let failure = 0; let count = 0; const tasks = new Map(); let id = 0;
  const options = { setTimeoutImpl: (fn, delay) => { tasks.set(++id, { fn, delay }); return id; }, clearTimeoutImpl: (key) => tasks.delete(key), fetchImpl: async (_, options) => {
    count++; if (failure) return response({ error: 'Unavailable' }, failure);
    if (options.method === 'PUT') { const next = JSON.parse(options.body); if (next.revision !== remote.revision) return response({ error: 'Conflict' }, 409); remote = { ...next, revision: remote.revision + 1 }; }
    return response(remote);
  } };
  return { options, tasks, get count() { return count; }, get remote() { return remote; }, set remote(value) { remote = value; }, set failure(value) { failure = value; } };
}

test('deduplicates loads, owns one visible timer, and adopts remote updates without local edits', async () => {
  const f = fixture(); const controller = createHomeSettingsController(f.options);
  await Promise.all([controller.load(), controller.load()]); assert.equal(f.count, 1); assert.equal(f.tasks.size, 1); assert.equal([...f.tasks.values()][0].delay, 30000);
  f.remote = { ...f.remote, revision: 1, layouts: { ...f.remote.layouts, mobile: [] } };
  const [key, task] = [...f.tasks.entries()][0]; f.tasks.delete(key); task.fn(); await controller.load();
  assert.deepEqual(controller.getState().settings.layouts.mobile, []); assert.equal(f.tasks.size, 1);
  controller.setVisible(false); assert.equal(f.tasks.size, 0); controller.setVisible(true); await controller.load(); assert.equal(f.tasks.size, 1); controller.dispose(); assert.equal(f.tasks.size, 0);
});

test('retains drafts on failure/conflict and saves both layouts atomically', async () => {
  const f = fixture(); const controller = createHomeSettingsController(f.options); await controller.load();
  controller.update((next) => { next.layouts.desktop = []; next.layouts.mobile = []; return next; }); f.failure = 503;
  assert.equal(await controller.save(), false); assert.equal(controller.getState().editing, true); assert.deepEqual(controller.getState().settings.layouts.desktop, []);
  f.failure = 0; assert.equal(await controller.save(), true); assert.equal(controller.getState().editing, false); assert.equal(f.remote.revision, 1); assert.deepEqual(f.remote.layouts, { desktop: [], mobile: [] });
  controller.begin(); controller.update((next) => { next.preferences.seconds = false; return next; });
  f.remote = { ...f.remote, revision: 2 }; await controller.load(); assert.equal(controller.getState().conflict, true); assert.equal(await controller.save(), false); assert.equal(f.remote.preferences.seconds, true);
  controller.cancel(); await controller.load(); assert.equal(controller.getState().settings.revision, 2); assert.equal(controller.getState().editing, false); controller.dispose();
});

test('mobile-only drafts save and cancel without changing desktop geometry', async () => {
  const f = fixture(); const controller = createHomeSettingsController(f.options); await controller.load(); const desktop = structuredClone(controller.getState().settings.layouts.desktop); const mobile = structuredClone(controller.getState().settings.layouts.mobile);
  controller.update((next) => { next.layouts.mobile = []; return next; }); f.failure = 503; assert.equal(await controller.save(), false); assert.deepEqual(controller.getState().settings.layouts.desktop, desktop); assert.deepEqual(controller.getState().settings.layouts.mobile, []);
  f.failure = 0; assert.equal(await controller.save(), true); assert.deepEqual(f.remote.layouts.desktop, desktop); assert.deepEqual(f.remote.layouts.mobile, []);
  controller.update((next) => { next.layouts.mobile = mobile; return next; }); controller.cancel(); await controller.load(); assert.deepEqual(controller.getState().settings.layouts.desktop, desktop); assert.deepEqual(controller.getState().settings.layouts.mobile, []); controller.dispose();
});

test('failed initial load does not invent or write defaults and simultaneous saves issue one mutation', async () => {
  const f = fixture(); f.failure = 503; const controller = createHomeSettingsController(f.options); await controller.load(); assert.equal(controller.getState().settings, null); assert.equal(await controller.save(), false);
  f.failure = 0; await controller.load(); controller.begin(); const before = f.count; await Promise.all([controller.save(), controller.save()]); assert.equal(f.count, before + 1); controller.dispose();
});

test('ignores an obsolete load after save and handles a conflict arriving directly from PUT', async () => {
  let release; let loads = 0; let remote = defaultHomeSettings();
  const controller = createHomeSettingsController({ fetchImpl: async (_, options) => {
    if (options.method === 'PUT') { if (remote.revision !== JSON.parse(options.body).revision) return response({ error: 'Conflict' }, 409); remote = { ...JSON.parse(options.body), revision: 1 }; return response(remote); }
    if (++loads === 2) return new Promise((resolve) => { release = resolve; }); return response(remote);
  } });
  await controller.load(); const pending = controller.load(); controller.update((next) => { next.layouts.desktop = []; return next; }); assert.equal(await controller.save(), true);
  release(response(defaultHomeSettings())); await pending; assert.equal(controller.getState().settings.revision, 1); assert.deepEqual(controller.getState().settings.layouts.desktop, []);
  controller.begin(); remote = { ...remote, revision: 2 }; assert.equal(await controller.save(), false); assert.equal(controller.getState().conflict, true); controller.dispose();
});
