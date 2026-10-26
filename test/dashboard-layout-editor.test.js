import test from 'node:test';
import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { createDashboardLayoutEditor } from '../public/dashboard-layout-editor.js';
import { captureAutomaticLayout } from '../public/dashboard-layout-automatic.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { WIDGET_ELEMENTS, initialWidgetProfile } from '../public/dashboard-layout.js';

// Small DOM seam for real editor handlers; native input validity is covered in Playwright.
function fixture() {
  const nodes = new Map(); const document = { activeElement: null, fullscreenEnabled: true }; const frame = { reference: { width: 1000, height: 800 }, fit: { x: 0, y: 0, scale: 1 } };
  class Node extends EventTarget {
    constructor(tag = 'div', id) {
      super(); this.tagName = tag; this.id = id; this.dataset = {}; this.children = []; this.attributes = {}; this.value = ''; this.min = ''; this.max = ''; this.hidden = false; this.disabled = false; this.className = ''; this.isConnected = true;
      this.style = { setProperty(key, value) { this[key] = value; } };
      this.classList = { toggle: (key, on) => { const names = new Set(this.className.split(' ')); if (on) names.add(key); else names.delete(key); this.className = [...names].join(' '); } };
      this.classList.add = key => this.classList.toggle(key, true); this.classList.remove = key => this.classList.toggle(key, false);
      if (id) nodes.set(id, this);
    }
    addEventListener(type, fn, options) { if (options?.signal) setMaxListeners(0, options.signal); super.addEventListener(type, fn, options); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    hasAttribute(key) { return key in this.attributes; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
      if (selector.includes(':not(:disabled)') && this.disabled) return false;
      const data = [...selector.matchAll(/\[data-([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
      for (const [, name, value] of data) { const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); if (!(key in this.dataset) || value !== undefined && this.dataset[key] !== value) return false; }
      if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
      const tag = selector.match(/^[a-z]+/)?.[0]; if (tag && this.tagName !== tag) return false;
      if (/\[(?:hidden|inert)\]/.test(selector)) return Boolean(this.hidden || this.inert);
      return Boolean(tag || data.length);
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { if (selector.endsWith(' span')) return this.querySelector(selector.slice(0, -5))?.querySelector('span'); return this.querySelectorAll(selector)[0]; }
    focus() { if (document.activeElement === this) return; document.activeElement?.emit('blur'); document.activeElement = this; this.emit('focus'); }
    getClientRects() { return this.hidden ? [] : [{}]; }
    get valueAsNumber() { return this.value.trim() ? Number(this.value) : NaN; }
    setCustomValidity(value) { this.error = value; }
    checkValidity() { return !this.error && Number.isInteger(this.valueAsNumber) && this.valueAsNumber >= Number(this.min) && this.valueAsNumber <= Number(this.max); }
    reportValidity() { return this.checkValidity(); }
    setPointerCapture(id) { this.pointer = id; }
    hasPointerCapture(id) { return this.pointer === id; }
    releasePointerCapture() { this.pointer = undefined; }
    emit(type, fields = {}) { const event = new Event(type, { cancelable: true }); for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value }); this.dispatchEvent(event); }
  }
  document.body = new Node('body'); document.activeElement = document.body; document.createElement = tag => new Node(tag); document.getElementById = id => nodes.get(id);
  const documentEvents = new Node(); document.addEventListener = (...args) => documentEvents.addEventListener(...args);
  const window = new Node(); window.innerWidth = 1000; window.innerHeight = 800;
  for (const name of ['toolbar', 'frames', 'status', 'details', 'toggle', 'close', 'profile', 'widget', 'arrangement', 'layers', 'save', 'cancel', 'reload', 'reset', 'fullscreen', 'form']) new Node('div', `layout-${name}`);
  for (const key of ['x', 'y', 'w', 'h']) new Node('input', `layout-${key}`);
  nodes.get('layout-toolbar').append(nodes.get('layout-details'), nodes.get('layout-layers')); nodes.get('layout-details').append(...['x', 'y', 'w', 'h'].map(key => nodes.get(`layout-${key}`)));
  new Node('button', 'edit-layout'); new Node('button', 'open-settings');
  for (const element of Object.values(WIDGET_ELEMENTS)) new Node('section', element);
  let rectangle = { left: 10, top: 789.6, width: 200, height: 40.4 }; let override; const writes = [];
  const state = { confirmed: true, source: 'general-local', saveToken: 'token-1', mode: 'local', snapshot: { revision: 1, preferences: normalizeDashboardPreferences() } };
  const view = { frame: () => frame, reference: () => frame.reference, lockReference() {}, releaseReference() {}, setOverride(value) { override = value; }, captureAutomatic: () => captureAutomaticLayout({ time: rectangle }, frame, 'desktop') };
  const editor = createDashboardLayoutEditor({ document, window, view, getState: () => state, canEnter: () => true, activeProfile: () => 'desktop', toggleFullscreen() {}, save: async (preferences, token) => { writes.push({ preferences, token }); state.snapshot.preferences = { ...state.snapshot.preferences, ...preferences }; } });
  const get = key => nodes.get(`layout-${key}`);
  const type = (key, value) => { const node = get(key); node.focus(); node.value = value; node.emit('input'); };
  async function change(key) { if (get('details').hidden) get('toggle').emit('click'); get(key).emit('change'); nodes.get('layout-widget').focus(); await Promise.resolve(); }
  return { editor, state, writes, get, type, change, window, view, get override() { return override; }, resize(value) { rectangle = { ...rectangle, ...value }; editor.refreshSurface(); } };
}

test('editor keeps short/negative Automatic observations valid and unchanged input exits without writing', async t => {
  const f = fixture(); t.after(() => f.editor.dispose()); f.window.emit('scroll'); f.editor.enter();
  assert.equal(f.override.profile, null); assert.equal(f.get('h').value, '40'); assert.equal(f.get('y').value, '-30'); assert.equal(f.get('h').checkValidity(), true); assert.equal(f.get('y').checkValidity(), true);
  f.type('h', '40.0'); await f.change('h'); f.type('y', '-30'); await f.change('y'); f.get('form').emit('submit'); await Promise.resolve();
  assert.equal(f.editor.active, false); assert.deepEqual(f.writes, []); assert.equal(f.state.snapshot.preferences.widgetLayout.desktop, null);
});

test('invalid changed observations retain null preview/raw input through measurement; a valid edit materializes', async t => {
  const f = fixture(); t.after(() => f.editor.dispose()); f.editor.enter(); f.type('h', '41'); await f.change('h');
  assert.match(f.get('h').error, /from 100/); assert.equal(f.override.profile, null);
  f.resize({ height: 60 }); assert.equal(f.get('h').value, '41'); assert.match(f.get('h').error, /from 100/);
  f.type('h', '100'); await f.change('h'); assert.ok(f.override.profile); f.get('form').emit('submit'); await Promise.resolve();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].token, 'token-1'); assert.deepEqual(Object.keys(f.writes[0].preferences), ['widgetLayout']); assert.equal(f.writes[0].preferences.widgetLayout.mobile, null);
});

test('unchanged raw observations are committed before a genuine edit in another field', async t => {
  const f = fixture(); t.after(() => f.editor.dispose()); f.editor.enter();
  f.type('w', '400'); f.type('h', '40'); f.get('form').emit('submit'); await Promise.resolve();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].preferences.widgetLayout.desktop.items.find(item => item.id === 'time').w, 400000);
});

test('focused baseline provenance survives remeasurement and refreshes only after the unchanged commit', async t => {
  const f = fixture(); t.after(() => f.editor.dispose()); f.editor.enter(); f.resize({ left: 1200 });
  f.type('x', '1200'); assert.equal(f.get('x').checkValidity(), true); f.resize({ left: 1300 }); assert.equal(f.get('x').value, '1200');
  await f.change('x'); assert.equal(f.get('x').value, '1300'); assert.equal(f.override.profile, null);
  f.get('form').emit('submit'); await Promise.resolve(); assert.deepEqual(f.writes, []);
});

test('zero-distance and canceled first gestures restore live Automatic while saved Custom ignores measurements', t => {
  const f = fixture(); t.after(() => f.editor.dispose()); f.editor.enter();
  const move = f.get('frames').querySelector('[data-widget="time"]').querySelector('[data-action=move]');
  f.get('frames').emit('pointerdown', { target: move, pointerId: 1, button: 0, clientX: 10, clientY: 20 });
  f.get('frames').emit('pointermove', { pointerId: 1, clientX: 10, clientY: 20 }); assert.equal(f.override.profile, null);
  f.get('frames').emit('pointermove', { pointerId: 1, clientX: 40, clientY: 20 }); assert.ok(f.override.profile);
  f.get('frames').emit('pointercancel', { pointerId: 1 }); assert.equal(f.override.profile, null); f.get('cancel').emit('click');
  const custom = initialWidgetProfile('desktop', 'right'); f.state.snapshot.preferences.widgetLayout.desktop = custom; f.editor.enter();
  assert.deepEqual(f.override.profile, custom); f.resize({ height: 500 }); assert.deepEqual(f.override.profile, custom);
});
