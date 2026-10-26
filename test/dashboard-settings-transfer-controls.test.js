import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsTransferControls } from '../public/dashboard-settings-transfer.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { deferred, tick } from './fixtures/lifecycle.js';

const bundle = { format: 'home-web.global-settings', version: 1, preferences: normalizeDashboardPreferences(), weatherLocation: null };
function setup(t) {
  const nodes = new Map(); const imports = []; const preparations = []; let allowed = true; let baseline; let preparing = false; let seq = 0; let epoch = 0;
  for (const id of ['settings-transfer-status', 'import-global-settings', 'export-global-settings', 'global-settings-file']) {
    const node = new EventTarget(); Object.assign(node, { value: '', files: [], disabled: false, textContent: '' }); nodes.set(id, node);
  }
  const coordinator = {
    getTransferState: () => ({ confirmed: Boolean(baseline), preparing, saveToken: baseline?.saveToken }),
    cancelTransferPreparation() { epoch++; baseline = undefined; },
    async prepareTransfer() { const owner = ++epoch; const read = deferred(); preparations.push(read); preparing = true; try { const result = await read.promise; if (owner === epoch) baseline = result; return result; } finally { if (owner === epoch) preparing = false; } },
    async importGlobal(...args) { imports.push(args); },
    exportGlobal: async () => bundle
  };
  const document = { getElementById: id => nodes.get(id) }; const window = { URL: { revokeObjectURL() {} } };
  const controls = createSettingsTransferControls({ document, window, coordinator, canImport: () => allowed }); t.after(() => controls.dispose()); controls.update();
  const complete = (index = preparations.length - 1) => preparations[index].resolve({ saveToken: `transfer-${++seq}`, snapshot: { revision: seq, integrations: { weather: { revision: seq + 2 } } } });
  const choose = async (text = JSON.stringify(bundle)) => { const input = nodes.get('global-settings-file'); input.files = [{ size: Buffer.byteLength(text), text: async () => text }]; input.value = 'global.json'; input.dispatchEvent(new Event('change')); await tick(); };
  return { nodes, imports, preparations, controls, complete, choose, allow(value) { allowed = value; controls.update(); } };
}

test('valid file preparation enables an explicit Global import without General scope and preserves draft guards', async t => {
  const f = setup(t); await f.choose(); assert.equal(f.nodes.get('import-global-settings').disabled, true); assert.equal(f.imports.length, 0);
  f.complete(); await tick(); assert.equal(f.nodes.get('import-global-settings').disabled, false);
  f.allow(false); assert.equal(f.nodes.get('import-global-settings').disabled, true); f.nodes.get('import-global-settings').dispatchEvent(new Event('click')); await tick(); assert.equal(f.imports.length, 0);
  f.allow(true); f.nodes.get('import-global-settings').dispatchEvent(new Event('click')); await tick();
  assert.deepEqual(f.imports, [[bundle, { preferencesRevision: 1, weatherRevision: 3 }, 'transfer-1']]); assert.equal(f.nodes.get('global-settings-file').value, '');
});

test('failed preparation retains the file and explicit Reload prepares new revisions', async t => {
  const f = setup(t); await f.choose(); f.preparations[0].reject(Error('offline fixture')); await tick();
  assert.match(f.nodes.get('settings-transfer-status').textContent, /offline/); assert.equal(f.nodes.get('global-settings-file').value, 'global.json'); assert.equal(f.nodes.get('import-global-settings').disabled, true);
  const reload = f.controls.rebase(); f.complete(); await reload; assert.equal(f.nodes.get('import-global-settings').disabled, false);
});

test('obsolete file preparations and disposal cannot enable imports or replace status', async t => {
  const f = setup(t); await f.choose(); await f.choose(JSON.stringify({ ...bundle, preferences: { ...bundle.preferences, seconds: false } }));
  f.complete(1); await tick(); const status = f.nodes.get('settings-transfer-status').textContent;
  f.preparations[0].resolve({ saveToken: 'obsolete', snapshot: {} }); await tick(); assert.equal(f.nodes.get('settings-transfer-status').textContent, status);
  assert.equal(f.nodes.get('import-global-settings').disabled, false);
  const reload = f.controls.rebase(); f.controls.dispose(); f.complete(2); await reload; assert.equal(f.nodes.get('settings-transfer-status').textContent, status);
});

test('malformed and oversized files never prepare authority or write settings', async t => {
  const f = setup(t); await f.choose('{bad'); assert.equal(f.preparations.length, 0); await f.choose('x'.repeat(131073));
  assert.match(f.nodes.get('settings-transfer-status').textContent, /128 KiB/); assert.equal(f.preparations.length, 0); assert.equal(f.imports.length, 0);
});
