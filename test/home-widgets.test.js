import test from 'node:test';
import assert from 'node:assert/strict';
import { createWidgetEditor, createWidgetOwners, gestureLayout, gridMetrics } from '../public/home-widgets.js';
import { defaultHomeSettings, changeWidget } from '../public/home-layout.js';
import { createHomeIntegrations, selectedHomeDevices } from '../public/home-integrations.js';

// Minimal event/geometry surface: tests drive the real editor handlers, not a copy of its algorithm.
class Element {
  constructor(document, tagName = '') { this.document = document; this.tagName = tagName.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {} }; this.hidden = false; this.value = ''; }
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
  getBoundingClientRect() { return { width: 1184 }; }
  closest() { return this.hidden ? this : this.parent?.closest(); }
  focus() { this.document.activeElement = this; }
}
function fixture(initial = [{ id: 'time', type: 'time', x: 0, y: 0, w: 4, h: 3 }], step = { x: 100, y: 80 }) {
  const document = { createElement: (tagName) => new Element(document, tagName), activeElement: null };
  const grid = new Element(document); const roots = Object.fromEntries(initial.map((item) => [item.id, new Element(document)])); grid.append(...Object.values(roots)); const root = roots.time;
  let items = initial; let changes = 0; let removed = 0; const announcements = [];
  const editor = createWidgetEditor({ document, grid, roots, measure: () => step, onChange: (next) => { items = next; changes++; editor.render(items, 'desktop', true); }, onRemove: () => removed++, announce: (message) => announcements.push(message) });
  editor.render(items, 'desktop', true);
  const controls = root.children.flatMap((child) => child.children).concat(root.children).filter((child) => child.dataset.kind);
  return { editor, root, grid, roots, announcements, heading: root.children[0], get items() { return items; }, get changes() { return changes; }, get removed() { return removed; }, move: controls.find((control) => control.dataset.kind === 'move'), remove: controls.find((control) => control.dataset.kind === 'remove'), resize: controls.find((control) => control.dataset.kind === 'resize') };
}

test('editor chrome has no visible title and keeps labeled controls only while editing', () => {
  const f = fixture();
  assert.deepEqual(f.heading.children.map((child) => [child.tagName, child.textContent]), [['BUTTON', 'Move'], ['BUTTON', 'Remove']]);
  assert.equal(f.move.attributes['aria-label'], 'Move Time; use arrow keys'); assert.equal(f.remove.attributes['aria-label'], 'Remove Time'); assert.equal(f.resize.attributes['aria-label'], 'Resize Time; use arrow keys');
  assert.equal(f.heading.hidden, false); f.editor.render(f.items, 'desktop', false); assert.equal(f.heading.hidden, true);
  assert.equal(f.move.hidden, true); assert.equal(f.remove.hidden, true); assert.equal(f.resize.hidden, true);
});

test('pointer movement previews and commits on release; cancel/breakpoint changes restore geometry', () => {
  const f = fixture(); f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientX: 200, clientY: 80 });
  assert.equal(f.changes, 0); assert.equal(f.root.style.gridColumn, '3 / span 4');
  f.move.dispatch('pointerup', { clientX: 200, clientY: 80 }); assert.equal(f.items[0].x, 2); assert.equal(f.items[0].y, 1); assert.equal(f.changes, 1); assert.equal(f.move.capture, null);
  f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientX: 400 }); f.move.dispatch('pointercancel'); assert.equal(f.changes, 1); assert.equal(f.root.style.gridColumn, '3 / span 4');
  f.move.dispatch('pointerdown'); f.editor.render([{ ...f.items[0], x: 0, w: 4 }], 'mobile', true); assert.equal(f.move.capture, null); assert.equal(f.changes, 1);
});

test('resize and keyboard edits use the same grid rules and content clicks cannot start gestures', () => {
  const f = fixture(); f.resize.dispatch('pointerdown'); f.resize.dispatch('pointerup', { clientX: 100, clientY: 160 });
  assert.equal(f.items[0].w, 5); assert.equal(f.items[0].h, 5);
  const expected = gestureLayout(f.items, 'time', 'resize', 1, 0, 'desktop'); f.resize.dispatch('keydown', { key: 'ArrowRight' }); assert.deepEqual(f.items, expected);
  f.root.dispatch('pointerdown'); f.root.dispatch('pointerup', { clientX: 500 }); assert.equal(f.changes, 2);
  const content = f.root.querySelector('.widget-content'); assert.ok(content);
  f.editor.render(f.items, 'desktop', false); f.move.dispatch('pointerdown'); f.move.dispatch('pointerup', { clientX: 500 }); assert.equal(f.changes, 2); assert.equal(f.root.querySelector('.widget-content'), content);
});

test('data owners survive geometry edits, reconcile removal, and resume exactly once after page restoration', () => {
  const calls = []; const integrations = { configure: (ids) => calls.push(['integration', ids]), suspend: () => calls.push(['suspend']) };
  const information = { configure: (ids) => calls.push(['information', ids]), setVisible: (visible) => calls.push(['visible', visible]) };
  const owners = createWidgetOwners({ integrations, information }); const settings = defaultHomeSettings();
  owners.configure(settings.layouts.desktop, settings); assert.equal(calls.length, 2);
  owners.configure(changeWidget(settings.layouts.desktop, 'time', { w: 2 }, 'desktop'), settings); assert.equal(calls.length, 2);
  const removed = settings.layouts.desktop.filter((item) => item.id !== 'calendar'); owners.configure(removed, settings); assert.equal(calls.length, 4); assert.ok(!calls[3][1].includes('calendar'));
  owners.suspend(); owners.configure(removed, settings); assert.equal(calls.length, 6); owners.resume(true); assert.equal(calls.length, 9); owners.configure(removed, settings); assert.equal(calls.length, 9);
});

test('upward previews keep capture and DOM order until release with a neighbor on the target row', () => {
  const initial = [{ id: 'weather', type: 'weather', x: 4, y: 0, w: 4, h: 3 }, { id: 'time', type: 'time', x: 0, y: 6, w: 4, h: 3 }];
  const f = fixture(initial, { x: 100, y: 35 }); const before = [...f.grid.children];
  f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientY: -210 });
  assert.equal(f.move.capture, 1); assert.deepEqual(f.grid.children, before); assert.equal(f.root.style.gridRow, '1 / span 3');
  f.move.dispatch('pointerup', { clientY: -210 }); assert.equal(f.items[0].id, 'time'); assert.equal(f.grid.children[0], f.root); assert.equal(f.move.capture, null); assert.equal(f.changes, 1);
  const keyboard = fixture(initial); for (let index = 0; index < 6; index++) keyboard.move.dispatch('keydown', { key: 'ArrowUp' }); assert.deepEqual(keyboard.items, f.items);
});

test('lost capture or container/fullscreen cancellation restores displaced widgets without committing', () => {
  const initial = [{ id: 'weather', type: 'weather', x: 0, y: 0, w: 4, h: 3 }, { id: 'time', type: 'time', x: 0, y: 6, w: 4, h: 3 }];
  const f = fixture(initial); f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientY: -480 }); f.move.releasePointerCapture();
  assert.equal(f.changes, 0); assert.deepEqual(f.items, initial); assert.equal(f.root.style.gridRow, '7 / span 3');
  f.move.dispatch('pointerdown'); f.move.dispatch('pointermove', { clientY: -480 }); f.editor.cancelGesture(); assert.equal(f.changes, 0); assert.equal(f.move.capture, null);
});

test('desktop full-grid resize is rejected and geometry metrics use measured rows and gaps', () => {
  const f = fixture(defaultHomeSettings().layouts.desktop); const before = structuredClone(f.items);
  f.resize.dispatch('pointerdown'); f.resize.dispatch('pointerup', { clientY: 80 }); assert.equal(f.changes, 0); assert.deepEqual(f.items, before); assert.match(f.announcements.at(-1), /Not enough desktop space/);
  f.resize.dispatch('keydown', { key: 'ArrowDown' }); assert.equal(f.changes, 0);
  assert.deepEqual(gridMetrics({ getBoundingClientRect: () => ({ width: 1184 }) }, 'desktop', () => ({ columnGap: '16px', rowGap: '8px', gridTemplateRows: '27px 27px' })), { x: 100, y: 35 });
  assert.deepEqual(gridMetrics({ getBoundingClientRect: () => ({ width: 384 }) }, 'mobile', () => ({ columnGap: '16px', rowGap: '16px', gridTemplateRows: '64px 64px' })), { x: 100, y: 80 });
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
