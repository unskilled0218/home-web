import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasMetrics, createWidgetEditor, createWidgetOwners, gestureLayout } from '../public/home-widgets.js';
import { changeWidget, defaultHomeSettings } from '../public/home-layout.js';
import { createHomeIntegrations, selectedHomeDevices } from '../public/home-integrations.js';

// Minimal event/geometry surface: tests drive the real editor handlers, not a copy of its algorithm.
class Element {
  constructor(document, tagName = '') { this.document = document; this.tagName = tagName.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.style = { setProperty(name, value) { this[name] = value; } }; this.classList = { add() {}, toggle() {} }; this.hidden = false; this.value = ''; }
  get childNodes() { return this.children; }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  prepend(node) { this.insertBefore(node, this.children[0]); }
  loseCapture() { if (this.capture !== undefined && this.capture !== null) this.releasePointerCapture(); for (const child of this.children) child.loseCapture(); }
  insertBefore(node, reference) { if (node.parent) { node.loseCapture(); node.parent.children.splice(node.parent.children.indexOf(node), 1); } const index = reference ? this.children.indexOf(reference) : this.children.length; this.children.splice(index, 0, node); node.parent = this; }
  querySelector() { return this.children.find((item) => item.className === 'widget-content'); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, fields = {}) { for (const fn of this.listeners[type] ?? []) fn({ currentTarget: this, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, ...fields }); }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; this.dispatch('lostpointercapture'); }
  getBoundingClientRect() { return { width: 500, height: 300 }; }
  closest() { return this.hidden ? this : this.parent?.closest(); }
  focus() { this.document.activeElement = this; }
}
function fixture(initial = { canvas: { width: 500, height: 300 }, items: [{ id: 'time', type: 'time', x: 0, y: 0, w: 200, h: 100 }] }, dimensions = { width: 500, height: 300 }) {
  const document = { createElement: (tagName) => new Element(document, tagName), activeElement: null };
  const grid = new Element(document); const roots = Object.fromEntries(initial.items.map((item) => [item.id, new Element(document)])); grid.append(...Object.values(roots)); const root = roots.time ?? Object.values(roots)[0];
  let layout = initial; let changes = 0; let removed = 0; const announcements = []; const changedModes = []; const removedModes = [];
  const editor = createWidgetEditor({ document, grid, roots, measure: () => dimensions, onChange: (next, nextMode) => { layout = next; changes++; changedModes.push(nextMode); editor.render(layout, nextMode, true); }, onRemove: (_id, nextMode) => { removed++; removedModes.push(nextMode); }, announce: (message) => announcements.push(message) });
  editor.render(layout, 'desktop', true);
  const controls = root.children.flatMap((child) => child.children).concat(root.children).filter((child) => child.dataset.kind);
  return { editor, root, grid, roots, announcements, changedModes, removedModes, heading: root.children[0], get layout() { return layout; }, get items() { return layout.items; }, get changes() { return changes; }, get removed() { return removed; }, move: controls.find((control) => control.dataset.kind === 'move'), remove: controls.find((control) => control.dataset.kind === 'remove'), resize: controls.find((control) => control.dataset.kind === 'resize') };
}

test('editor chrome has no visible title and keeps labeled controls only while editing', () => {
  const f = fixture();
  assert.deepEqual(f.heading.children.map((child) => [child.tagName, child.textContent]), [['BUTTON', 'Move'], ['BUTTON', 'Remove']]);
  assert.equal(f.move.attributes['aria-label'], 'Move Time; use arrow keys'); assert.equal(f.remove.attributes['aria-label'], 'Remove Time'); assert.equal(f.resize.attributes['aria-label'], 'Resize Time; use arrow keys');
  assert.equal(f.heading.hidden, false); f.editor.render(f.layout, 'desktop', false); assert.equal(f.heading.hidden, true);
  assert.equal(f.move.hidden, true); assert.equal(f.remove.hidden, true); assert.equal(f.resize.hidden, true);
});

test('one-pixel pointer and keyboard resizing commit exact pixel geometry', () => {
  const f = fixture(); f.resize.dispatch('pointerdown'); f.resize.dispatch('pointermove', { clientX: 1, clientY: 2 });
  assert.equal(f.root.style.width, '201px'); assert.equal(f.root.style.height, '102px'); assert.equal(f.changes, 0);
  f.resize.dispatch('pointerup', { clientX: 1, clientY: 2 }); assert.equal(f.items[0].w, 201); assert.equal(f.items[0].h, 102); assert.equal(f.changes, 1);
  f.resize.dispatch('keydown', { key: 'ArrowRight' }); assert.equal(f.items[0].w, 202); assert.match(f.announcements.at(-1), /one pixel/);
});

test('pixel movement previews, commits, and cancels without track rounding', () => {
  const f = fixture(); f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientX: 2, clientY: 3 });
  assert.equal(f.root.style.left, '2px'); assert.equal(f.root.style.top, '3px'); assert.equal(f.changes, 0);
  f.move.dispatch('pointerup', { clientX: 2, clientY: 3 }); assert.equal(f.items[0].x, 2); assert.equal(f.items[0].y, 3);
  f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientX: 10, clientY: 10 }); f.move.dispatch('pointercancel'); assert.equal(f.root.style.left, '2px'); assert.equal(f.changes, 1);
});

test('upward movement reaches the canvas top while retaining capture and DOM order', () => {
  const initial = { canvas: { width: 500, height: 300 }, items: [{ id: 'weather', type: 'weather', x: 250, y: 0, w: 250, h: 120 }, { id: 'time', type: 'time', x: 0, y: 100, w: 200, h: 100 }] };
  const f = fixture(initial); const before = [...f.grid.children]; f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientY: -100 });
  assert.equal(f.move.capture, 1); assert.deepEqual(f.grid.children, before); assert.equal(f.root.style.top, '0px');
  f.move.dispatch('pointerup', { clientY: -100 }); assert.equal(f.items.find((item) => item.id === 'time').y, 0); assert.equal(f.move.capture, null);
});

test('lost capture and mode changes restore previews without committing', () => {
  const f = fixture(); f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientX: 20 }); f.move.releasePointerCapture();
  assert.equal(f.changes, 0); assert.equal(f.root.style.left, '0px');
  f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientX: 20 }); f.editor.render(f.layout, 'mobile', true); assert.equal(f.move.capture, null); assert.equal(f.changes, 0); assert.deepEqual(f.changedModes, []);
});

test('editor-managed mobile height changes do not cancel an active gesture', () => {
  const dimensions = { width: 320, height: 600 }; const f = fixture(undefined, dimensions); f.editor.render(f.layout, 'mobile', true);
  f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientY: 1 }); dimensions.height = 650; f.editor.resize();
  assert.equal(f.move.capture, 1); f.move.dispatch('pointerup', { clientY: 1 }); assert.equal(f.changes, 1);
});

test('impossible pixel edits announce the bounded placement failure', () => {
  const initial = { canvas: { width: 320, height: 240 }, items: [{ id: 'weather', type: 'weather', x: 0, y: 0, w: 320, h: 120 }, { id: 'time', type: 'time', x: 0, y: 120, w: 320, h: 120 }] };
  const f = fixture(initial, { width: 320, height: 240 }); f.resize.dispatch('pointerdown'); f.resize.dispatch('pointerup', { clientY: 1 });
  assert.equal(f.changes, 0); assert.match(f.announcements.at(-1), /Not enough space/);
  assert.deepEqual(canvasMetrics({ getBoundingClientRect: () => ({ width: 319.6, height: 239.6 }) }), { width: 320, height: 240 });
});

test('data owners survive geometry edits and reconcile membership changes', () => {
  const calls = []; const integrations = { configure: (ids) => calls.push(['integration', ids]), suspend: () => calls.push(['suspend']) }; const information = { configure: (ids) => calls.push(['information', ids]), setVisible: (visible) => calls.push(['visible', visible]) };
  const owners = createWidgetOwners({ integrations, information }); const settings = defaultHomeSettings(); const items = settings.layouts.desktop.items;
  owners.configure(items, settings); assert.equal(calls.length, 2); owners.configure(changeWidget(settings.layouts.desktop, 'time', { w: items[0].w - 1 }, 'desktop').items, settings); assert.equal(calls.length, 2);
  const removed = items.filter((item) => item.id !== 'calendar'); owners.configure(removed, settings); assert.equal(calls.length, 4); assert.ok(!calls[3][1].includes('calendar'));
  owners.suspend(); owners.configure(removed, settings); assert.equal(calls.length, 6); owners.resume(true); assert.equal(calls.length, 9);
});

test('gesture helper applies pixel deltas through the shared layout model', () => {
  const layout = { canvas: { width: 500, height: 300 }, items: [{ id: 'time', type: 'time', x: 10, y: 10, w: 200, h: 100 }] };
  assert.equal(gestureLayout(layout, 'time', 'move', 1, 1, 'desktop').items[0].x, 11);
  assert.equal(gestureLayout(layout, 'time', 'resize', 1, 1, 'desktop').items[0].w, 201);
});

test('selected devices and readings use identities, preserve missing selections, and keep current controls', () => {
  const devices = [{ selectionId: 'a', name: 'Same name', measurements: [{ selectionId: 'reading-a', name: 'Temperature', value: '20' }], controls: [{ controlToken: 'current' }] }, { selectionId: 'b', name: 'Same name', measurements: [], controls: [] }];
  const selected = selectedHomeDevices(devices, [{ id: 'a', readings: ['reading-a', 'missing'] }, { id: 'gone', readings: [] }]);
  assert.equal(selected[0].measurements[0].value, '20'); assert.equal(selected[0].measurements[1].available, false); assert.equal(selected[0].controls[0].controlToken, 'current'); assert.equal(selected[1].name, 'Selected device unavailable');
  devices[0].name = 'Renamed'; devices.reverse(); assert.equal(selectedHomeDevices(devices, [{ id: 'a', readings: [] }])[0].name, 'Renamed'); assert.deepEqual(selectedHomeDevices(devices, []), []);
});

test('removing an integration invalidates its pending device snapshot and re-adding loads once', async () => {
  const nodes = new Map(); const document = { activeElement: null, createElement: () => new Element(document), querySelector: (selector) => { if (!nodes.has(selector)) nodes.set(selector, new Element(document)); return nodes.get(selector); } };
  const pending = []; const snapshots = [];
  const integrations = createHomeIntegrations({ document, onDevices: (devices) => snapshots.push(devices), fetchImpl: async (url) => {
    if (url === '/api/home-assistant') return { ok: true, json: async () => ({ homeAssistant: { configured: true } }) };
    return new Promise((resolve) => pending.push(resolve));
  } });
  integrations.configure(['home-assistant'], []); await new Promise(setImmediate); assert.equal(pending.length, 1);
  integrations.configure([], []); pending.shift()({ ok: true, json: async () => ({ devices: [{ name: 'obsolete' }] }) }); await new Promise(setImmediate); assert.equal(snapshots.length, 0);
  integrations.configure(['home-assistant'], []); integrations.configure(['home-assistant'], []); await new Promise(setImmediate); assert.equal(pending.length, 1);
  pending.shift()({ ok: true, json: async () => ({ devices: [] }) }); await new Promise(setImmediate); assert.deepEqual(snapshots, [[]]); integrations.suspend();
});
