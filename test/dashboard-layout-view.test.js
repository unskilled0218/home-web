import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardLayoutView, measureLayoutSurface } from '../public/dashboard-layout-view.js';
import { defaultWidgetLayout, initialWidgetProfile, WIDGET_ELEMENTS } from '../public/dashboard-layout.js';

function fixture() {
  const nodes = new Map(); const listeners = new Map(); const frames = new Map(); const observers = []; let sequence = 0;
  const document = { getElementById: id => nodes.get(id), querySelector: () => nodes.get('tools'), createComment: () => new Node(), documentElement: {} };
  class Node {
    constructor(id) {
      this.id = id; this.children = []; this.textContent = ''; this.hidden = false; this.rect = { bottom: 0 };
      const properties = new Map(); this.classList = { toggle: (key, value) => properties.set(key, value), contains: key => Boolean(properties.get(key)) };
      this.style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key.startsWith('--') ? key : key.replace(/-([a-z])/g, (_, value) => value.toUpperCase())]; } };
      if (id) nodes.set(id, this);
    }
    insert(index, children) {
      for (const child of children) {
        if (child.parent) { const old = child.parent.children.indexOf(child); child.parent.children.splice(old, 1); if (child.parent === this && old < index) index--; }
        child.parent = this; this.children.splice(index++, 0, child);
      }
    }
    append(...children) { this.insert(this.children.length, children); }
    before(...children) { this.parent.insert(this.parent.children.indexOf(this), children); }
    after(...children) { this.parent.insert(this.parent.children.indexOf(this) + 1, children); }
    getBoundingClientRect() { return this.rect; }
    get isConnected() { return true; }
    focus() { document.activeElement = this; }
  }
  const body = new Node('body'); document.body = body; document.activeElement = body;
  body.append(new Node('tools'), new Node('page-status'), new Node('dashboard-content'), new Node('widget-surface'));
  nodes.get('tools').rect.bottom = 70; nodes.get('page-status').rect.bottom = 70;
  const information = new Node('information'); const devices = new Node('dashboard-devices');
  nodes.get('dashboard-content').append(information, devices, new Node('bookmarks'));
  information.append(new Node('calendar'), new Node('clock'), new Node('weather'), new Node('photo-caption'));
  devices.append(new Node('dashboard-ha'), new Node('dashboard-wol'));
  const window = {
    innerWidth: 1200, innerHeight: 800,
    getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    ResizeObserver: class { constructor(fn) { this.fn = fn; this.nodes = []; observers.push(this); } observe(node) { this.nodes.push(node); } disconnect() { this.nodes = []; } }
  };
  return { document, window, nodes, frames, listeners, observers };
}

test('layout measurement stays independent of hidden content and reserves bounded caption/tool space', () => {
  const f = fixture(); f.nodes.get('dashboard-content').hidden = true;
  assert.deepEqual(measureLayoutSurface(f.document, f.window), { x: 16, y: 78, width: 1168, height: 706 });
  f.nodes.get('photo-caption').textContent = 'A long filename';
  assert.equal(measureLayoutSurface(f.document, f.window).height, 658);
  f.window.innerWidth = 80; f.window.innerHeight = 50;
  assert.equal(measureLayoutSurface(f.document, f.window).height, 0);
});

test('custom projection retains widget identity, restores automatic groups/order, and never mutates layout', () => {
  const f = fixture(); let measurements = 0;
  const view = createDashboardLayoutView({ ...f, onMeasure() { measurements++; } });
  const layout = { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop') }; const before = structuredClone(layout);
  const display = { content: true }; const clock = f.nodes.get('clock'); clock.focus();
  view.update({ layout, mobile: false, scale: 1.2, display });
  assert.equal(clock.parent, f.nodes.get('widget-surface'));
  assert.ok(clock.style.bottom.endsWith('px')); assert.equal(clock.style.top, undefined);
  assert.equal(f.nodes.get('dashboard-content').hidden, true);
  assert.equal(f.document.activeElement, clock);
  for (const [index, item] of layout.desktop.items.entries()) assert.equal(f.nodes.get(WIDGET_ELEMENTS[item.id]).style.zIndex, String(index + 1));
  view.update({ layout, mobile: true, scale: 1.2, display });
  assert.equal(clock.parent, f.nodes.get('information')); assert.equal(clock.style.width, undefined); assert.equal(clock.style.bottom, undefined);
  assert.deepEqual(f.nodes.get('information').children.filter(node => node.id).map(node => node.id), ['clock', 'weather', 'calendar', 'photo-caption']);
  assert.equal(f.nodes.get('dashboard-ha').parent, f.nodes.get('dashboard-devices'));
  assert.equal(f.nodes.get('bookmarks').parent, f.nodes.get('dashboard-content'));
  assert.equal(f.document.body.classList.contains('custom-widget-layout'), false);
  assert.deepEqual(layout, before); assert.equal(measurements, 2); view.dispose();
});

test('resize observation coalesces one DOM-only frame and disposal removes all ownership', () => {
  const f = fixture(); let measurements = 0;
  const view = createDashboardLayoutView({ ...f, onMeasure() { measurements++; } });
  const state = { layout: { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop') }, mobile: false, scale: 1, display: { content: false } };
  view.update(state); assert.equal(f.nodes.get('widget-surface').hidden, true); assert.ok(view.surface().width > 0);
  for (let i = 0; i < 10; i++) f.observers[0].fn(); assert.equal(f.frames.size, 1);
  const fn = [...f.frames.values()][0]; f.frames.clear(); fn(); assert.equal(measurements, 2);
  f.listeners.get('resize')(); assert.equal(f.frames.size, 1);
  view.dispose(); assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0); assert.equal(f.observers[0].nodes.length, 0);
  fn(); assert.equal(measurements, 2, 'late frame cannot update a disposed view');
});

test('projected padding dimensions update on resize and never leak into Automatic mode', () => {
  const f = fixture(); const view = createDashboardLayoutView(f);
  const layout = { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop') }; const before = structuredClone(layout);
  const state = { layout, mobile: false, scale: 1, display: { content: true } };
  for (const [width, height] of [[1200, 800], [33, 95], [1200, 800]]) {
    f.window.innerWidth = width; f.window.innerHeight = height; view.update(state);
    for (const id of Object.values(WIDGET_ELEMENTS)) {
      const node = f.nodes.get(id);
      assert.equal(node.style['--widget-width'], node.style.width, `${id} padding uses projected width`);
      assert.equal(node.style['--widget-height'], node.style.height, `${id} padding uses projected height`);
    }
  }
  view.update({ ...state, layout: defaultWidgetLayout() });
  for (const id of Object.values(WIDGET_ELEMENTS)) {
    const node = f.nodes.get(id);
    assert.equal(node.style['--widget-width'], undefined, `${id} Automatic width is clean`);
    assert.equal(node.style['--widget-height'], undefined, `${id} Automatic height is clean`);
  }
  assert.deepEqual(layout, before); view.dispose();
});
