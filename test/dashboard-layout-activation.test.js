import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutActivation } from '../public/dashboard-layout-activation.js';
import { WIDGET_ELEMENTS } from '../public/dashboard-layout.js';

function fixture() {
  const document = new EventTarget(); const window = new EventTarget(); const timers = new Map(); const calls = []; let next = 0; let allowed = true;
  const nodes = Object.fromEntries(Object.values(WIDGET_ELEMENTS).map(id => [id, { id, isConnected: true, getClientRects: () => [1], classList: { add() {}, remove() {} }, matches: () => false }]));
  document.getElementById = id => nodes[id]; document.elementFromPoint = () => nodes.clock; window.getSelection = () => ({ isCollapsed: true });
  const controller = createLayoutActivation({ document, window, canEnter: () => allowed, activate: (...args) => { calls.push(args); return true; }, schedule(fn, delay) { timers.set(++next, { fn, delay }); return next; }, cancel: id => timers.delete(id) });
  function emit(type, props = {}, owner = document) { const event = new Event(type, { cancelable: true }); Object.defineProperties(event, Object.fromEntries(Object.entries({ button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 50, detail: 1, target: nodes.clock, composedPath: () => [props.target || nodes.clock, nodes.clock], ...props }).map(([key, value]) => [key, { value }]))); owner.dispatchEvent(event); return event; }
  function fire() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); }
  return { document, window, nodes, timers, calls, controller, emit, fire, disallow() { allowed = false; } };
}

test('one 600ms primary hold selects the widget; release/click are consumed, keyboard and later clicks are not', () => {
  const f = fixture(); const down = f.emit('pointerdown'); assert.equal(down.defaultPrevented, false); assert.equal([...f.timers.values()][0].delay, 600);
  f.fire(); assert.deepEqual(f.calls[0], ['time', f.nodes.clock]); assert.equal(f.controller.blocked(), true);
  assert.equal(f.emit('click', { detail: 0 }).defaultPrevented, false);
  assert.equal(f.emit('pointerup').defaultPrevented, true); assert.equal(f.controller.blocked(), false);
  assert.equal(f.emit('click').defaultPrevented, true); assert.equal(f.emit('click').defaultPrevented, false); f.controller.dispose(); assert.equal(f.timers.size, 0);
});

for (const [name, cancel] of Object.entries({
  'early release': f => f.emit('pointerup'),
  '8px screen movement': f => f.emit('pointermove', { clientX: 58 }),
  'nested scroll': f => f.emit('scroll'),
  'second pointer': f => f.emit('pointerdown', { pointerId: 2, isPrimary: false }),
  'pointer cancellation': f => f.emit('pointercancel'),
  'window blur': f => f.emit('blur', {}, f.window),
  'page hiding': f => { f.document.hidden = true; f.emit('visibilitychange'); },
  'pagehide': f => f.emit('pagehide', {}, f.window),
  'explicit cancellation': f => f.controller.cancel(),
  'disposal': f => f.controller.dispose()
})) test(`hold cancellation: ${name} rejects even an already queued timer`, () => {
  const f = fixture(); f.emit('pointerdown'); const late = [...f.timers.values()][0].fn; cancel(f); late(); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); f.controller.dispose();
});

for (const [name, change] of Object.entries({
  'removed target': f => { f.nodes.clock.isConnected = false; },
  'hidden target': f => { f.nodes.clock.getClientRects = () => []; },
  'covered target': f => { f.document.elementFromPoint = () => f.nodes.weather; },
  'interactive hit': f => { f.document.elementFromPoint = () => ({ parentElement: f.nodes.clock, matches: () => true }); },
  'Settings or write started': f => f.disallow(),
  'text selection created': f => { f.window.getSelection = () => ({ isCollapsed: false }); },
  'hidden page': f => { f.document.hidden = true; }
})) test(`hold timer rechecks ${name}`, () => { const f = fixture(); f.emit('pointerdown'); change(f); f.fire(); assert.equal(f.calls.length, 0); f.controller.dispose(); });

test('interactive descendants, selection, right buttons and nonprimary pointers do not arm; widget focus does not exclude its root', () => {
  const f = fixture(); const child = { parentElement: f.nodes.clock, matches: () => true };
  f.emit('pointerdown', { target: child }); f.emit('pointerdown', { button: 2 }); f.emit('pointerdown', { isPrimary: false });
  f.window.getSelection = () => ({ isCollapsed: false }); f.emit('pointerdown'); assert.equal(f.timers.size, 0);
  f.window.getSelection = () => ({ isCollapsed: true }); f.nodes.clock.matches = () => true; f.emit('pointerdown'); f.fire(); assert.equal(f.calls.length, 1); f.controller.dispose();
});

test('context menus are scoped to eligible hold locations; small movement and wrong pointer releases retain the hold', () => {
  const f = fixture(); assert.equal(f.emit('contextmenu').defaultPrevented, false); f.emit('pointerdown'); f.emit('pointermove', { clientX: 57 }); f.emit('pointerup', { pointerId: 2 });
  assert.equal(f.emit('contextmenu').defaultPrevented, true);
  assert.equal(f.emit('contextmenu', { target: { matches: () => true }, clientX: 200 }).defaultPrevented, false);
  f.fire(); f.emit('pointerup'); f.fire(); assert.equal(f.emit('click').defaultPrevented, false); f.controller.dispose();
});

test('disposal removes delegated listeners and consumed-release timeout', () => {
  const f = fixture(); f.emit('pointerdown'); f.fire(); f.controller.dispose(); assert.equal(f.timers.size, 0); f.emit('pointerdown'); f.emit('scroll'); f.emit('pointerup'); assert.equal(f.emit('contextmenu').defaultPrevented, false); assert.equal(f.timers.size, 0);
});

test('pen and touch pointer types follow the same primary hold contract without pointer capture', () => {
  for (const pointerType of ['pen', 'touch']) { const f = fixture(); assert.equal(f.emit('pointerdown', { pointerType }).defaultPrevented, false); f.fire(); assert.equal(f.calls.length, 1); f.controller.dispose(); }
});

test('click suppression follows the release point, not a reused mouse ID or the next real pointer sequence', () => {
  const f = fixture(); f.emit('pointerdown'); f.fire(); f.emit('pointerup', { clientX: 150 });
  assert.equal(f.emit('click', { clientX: 50 }).defaultPrevented, false);
  assert.equal(f.emit('click', { clientX: 150, pointerId: 2 }).defaultPrevented, false);
  assert.equal(f.emit('click', { clientX: 150 }).defaultPrevented, true);
  f.emit('pointerdown'); f.fire(); f.emit('pointerup'); f.disallow();
  f.emit('pointerdown', { clientX: 200 }); assert.equal(f.emit('click', { clientX: 200 }).defaultPrevented, false); assert.equal(f.timers.size, 0); f.controller.dispose();
});
