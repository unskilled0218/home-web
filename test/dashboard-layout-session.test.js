import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutSession } from '../public/dashboard-layout-session.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';

const state = (confirmed = true) => ({ confirmed, snapshot: { revision: 7, preferences: normalizeDashboardPreferences() } });
const reference = { width: 1600, height: 900 };

test('measured Automatic candidates stay session-local until a real change and preserve other profiles/tokens', () => {
  const session = createLayoutSession(); const initial = state(); initial.saveToken = 'general-local-token'; initial.source = 'general-local-source'; session.load(initial, 'desktop');
  const measured = session.effective(); measured.items[0].x = 12345; measured.items[0].w = 200000;
  session.preview('desktop', measured); measured.items[0].x = 999;
  assert.equal(session.effective().items[0].x, 12345); assert.equal(session.changed(), false); assert.equal(session.draft.desktop, null);
  session.edit({}, reference); assert.equal(session.changed(), false);
  session.arrange('custom'); assert.equal(session.changed(), true); assert.equal(session.draft.desktop.items[0].x, 12345); assert.equal(session.draft.mobile, null);
  session.restore(null); assert.equal(session.changed(), false); assert.equal(session.effective().items[0].x, 12345);
  session.mode = 'mobile'; assert.notEqual(session.effective().items[0].x, 12345); session.mode = 'desktop'; session.layer('front', session.effective().items[0].id);
  assert.equal(session.payload().revision, 'general-local-token'); assert.deepEqual(Object.keys(session.payload().preferences), ['widgetLayout']); assert.equal(session.source, 'general-local-source');
  session.arrange('automatic'); session.preview('desktop', null); assert.equal(session.changed(), false); assert.notEqual(session.effective().items[0].x, 12345);
});

test('Automatic templates, selection and boundary/no-op operations do not materialize Custom', () => {
  const session = createLayoutSession(); session.load(state(), 'desktop'); const template = session.effective();
  session.selected = template.items.at(-1).id; session.layer('front'); session.edit({}, reference);
  session.mode = 'mobile'; session.effective(); session.mode = 'desktop';
  assert.equal(session.changed(), false); assert.equal(session.draft.desktop, null); assert.equal(session.draft.mobile, null);
  session.arrange('custom'); assert.equal(session.changed(), true); assert.deepEqual(session.draft.desktop, template);
  session.arrange('automatic'); assert.equal(session.changed(), false);
});

test('entry baseline and revision are immutable and complete; only explicit reload rebases both profiles', () => {
  const initial = state(); const session = createLayoutSession(); session.load(initial, 'desktop');
  session.edit({ x: 30 }, reference); session.mode = 'mobile'; session.arrange('custom');
  initial.snapshot.preferences.color = '#ffffff'; initial.snapshot.revision = 9;
  const payload = session.payload(); assert.equal(payload.revision, 7); assert.deepEqual(Object.keys(payload.preferences), ['widgetLayout']); assert.ok(payload.preferences.widgetLayout.desktop); assert.ok(payload.preferences.widgetLayout.mobile);
  payload.preferences.widgetLayout.desktop.items[0].x = 999; assert.notEqual(session.draft.desktop.items[0].x, 999);
  session.load(initial, session.mode); assert.equal(session.revision, 9); assert.equal(session.changed(), false); assert.equal(session.draft.desktop, null); assert.equal(session.draft.mobile, null);
});

test('fixed-start previews and canceled operations restore exact canonical Automatic state', () => {
  const session = createLayoutSession(); session.load(state(), 'desktop'); const original = session.effective();
  session.edit({ x: 20 }, reference, original); const first = structuredClone(session.draft);
  session.restore(null); session.edit({ x: 20 }, reference, original); assert.deepEqual(session.draft, first);
  session.restore(null); assert.equal(session.changed(), false);
});

test('offline cache cannot capture a writable revision until explicit confirmed load', () => {
  const session = createLayoutSession(); const cached = state(false); session.load(cached, 'desktop'); session.arrange('custom');
  cached.confirmed = true; cached.snapshot.revision = 10; assert.equal(session.payload().revision, null);
  session.load(cached, 'desktop'); assert.equal(session.revision, 10); assert.equal(session.changed(), false);
});

test('explicit widget layer targets preserve selection, canonical rectangles and the other profile', () => {
  const session = createLayoutSession(); session.load(state(), 'desktop', 'time'); session.arrange('custom');
  const before = structuredClone(session.draft); const order = before.desktop.items.map(item => item.id); const target = order[0];
  session.layer('forward', target); assert.equal(session.selected, 'time'); assert.deepEqual(session.draft.desktop.items.map(item => item.id), [order[1], order[0], ...order.slice(2)]);
  const byId = items => [...items].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(session.draft.desktop.items), byId(before.desktop.items)); assert.deepEqual(session.draft.mobile, before.mobile); assert.equal(session.revision, 7);
});

test('explicit layer boundaries keep Automatic null, while a genuine targeted step creates only that profile', () => {
  const session = createLayoutSession(); session.load(state(), 'mobile'); const template = session.effective();
  session.layer('backward', template.items[0].id); session.layer('forward', template.items.at(-1).id); assert.equal(session.changed(), false); assert.equal(session.draft.mobile, null);
  session.layer('forward', template.items[0].id); assert.equal(session.changed(), true); assert.equal(session.draft.desktop, null);
  assert.deepEqual(session.draft.mobile.items, [template.items[1], template.items[0], ...template.items.slice(2)]);
});

test('visible-only layer boundaries preserve Automatic and genuine edits retain hidden slots and the other profile', () => {
  const session = createLayoutSession(); session.load(state(), 'desktop'); const original = session.effective();
  const ids = [original.items[1].id, original.items[4].id];
  session.layer('backward', ids[0], ids); session.layer('forward', ids[1], ids); session.layer('front', original.items[0].id, ids);
  assert.equal(session.changed(), false); assert.equal(session.draft.desktop, null);
  session.layer('forward', ids[0], ids);
  const saved = session.payload().preferences.widgetLayout; assert.equal(saved.desktop.items.length, 6); assert.equal(saved.mobile, null);
  for (const index of [0, 2, 3, 5]) assert.deepEqual(saved.desktop.items[index], original.items[index]);
  assert.deepEqual(saved.desktop.items[1], original.items[4]); assert.deepEqual(saved.desktop.items[4], original.items[1]);
});
