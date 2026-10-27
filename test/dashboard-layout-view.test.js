import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardLayoutView, measureLayoutSurface } from '../public/dashboard-layout-view.js';
import { defaultWidgetLayout, initialWidgetProfile, WIDGET_ELEMENTS } from '../public/dashboard-layout.js';
import { dashboardDisplay, applyDashboardDisplay } from '../public/dashboard-display.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';

function fixture() {
  const nodes = new Map(); const listeners = new Map(); const frames = new Map(); const observers = []; let sequence = 0;
  const document = { getElementById: id => nodes.get(id), querySelector: () => nodes.get('tools'), createComment: () => new Node(), documentElement: {}, addEventListener: (name, fn) => listeners.set(`document:${name}`, fn), removeEventListener: name => listeners.delete(`document:${name}`) };
  class Node {
    constructor(id) {
      this.id = id; this.children = []; this.textContent = ''; this.hidden = false; this.rect = { bottom: 0 }; this.dataset = {};
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
    innerWidth: 1200, innerHeight: 800, screen: { width: 1600, height: 1000 },
    getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    ResizeObserver: class { constructor(fn) { this.fn = fn; this.nodes = []; observers.push(this); } observe(node) { this.nodes.push(node); } disconnect() { this.nodes = []; } }
  };
  return { document, window, nodes, frames, listeners, observers };
}

test('layout measurement ignores content, tools, status and captions and uses the full viewport', () => {
  const f = fixture(); f.nodes.get('dashboard-content').hidden = true;
  assert.deepEqual(measureLayoutSurface(f.document, f.window), { x: 0, y: 0, width: 1200, height: 800 });
  f.nodes.get('photo-caption').textContent = 'A long filename';
  assert.equal(measureLayoutSurface(f.document, f.window).height, 800);
  f.window.innerWidth = 80; f.window.innerHeight = 50;
  assert.equal(measureLayoutSurface(f.document, f.window).height, 50);
  f.window.innerHeight = 0; assert.equal(measureLayoutSurface(f.document, f.window).height, 0);
});

test('caption visibility survives Automatic/Custom reparenting and image toggles preserve saved geometry', () => {
  const f = fixture(); f.nodes.set('photos', { hidden: false });
  const view = createDashboardLayoutView(f); const caption = f.nodes.get('photo-caption'); caption.textContent = 'current.png';
  const layout = { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop') }; const before = structuredClone(layout);
  try {
    for (const imageVisible of [false, true, false]) for (const mobile of [false, true]) {
      const settings = normalizeDashboardPreferences({ imageVisible, widgetLayout: layout });
      const display = dashboardDisplay(settings, { mobile, caption: true });
      applyDashboardDisplay(f.document, display); view.update({ layout, mobile, scale: 1, display });
      assert.equal(caption.hidden, !imageVisible); assert.equal(f.nodes.get('photos').hidden, !imageVisible);
      assert.equal(caption.parent, mobile ? f.nodes.get('information') : f.document.body);
      assert.deepEqual(layout, before); assert.equal(f.nodes.get('clock').hidden, false);
    }
  } finally { view.dispose(); }
});

test('explicit Automatic overrides retain live nodes and exact measurements, then restore latest Custom state', () => {
  const f = fixture(); const view = createDashboardLayoutView(f); const layout = { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop') };
  const state = { layout, mobile: false, position: 'right', scale: 1, display: { content: true } };
  view.update(state); assert.equal(view.captureAutomatic('desktop'), null);
  view.lockReference(); view.setOverride({ mode: 'desktop', profile: null });
  const clock = f.nodes.get('clock'); clock.rect = { left: 50.5, top: 740, width: 300, height: 40 };
  assert.equal(clock.parent, f.nodes.get('information')); assert.equal(f.nodes.get('widget-surface').hidden, true);
  const capture = view.captureAutomatic('desktop'); assert.deepEqual(capture.screen.time, clock.rect); assert.ok(capture.pixels.time.h < 100);
  assert.equal(view.captureAutomatic('mobile'), null); assert.deepEqual(layout.desktop, initialWidgetProfile('desktop'));
  const observation = f.observers.at(-1); assert.ok(observation.nodes.includes(clock));
  observation.fn(); observation.fn(); f.listeners.get('scroll')(); assert.equal(f.frames.size, 1);
  const next = { ...layout, desktop: initialWidgetProfile('desktop', 'right') }; view.update({ ...state, layout: next }); assert.equal(clock.parent, f.nodes.get('information'));
  view.setOverride(null); assert.equal(clock.parent, f.nodes.get('widget-surface')); assert.equal(observation.nodes.length, 0); assert.equal(f.listeners.has('scroll'), false);
  f.frames.clear(); observation.fn(); assert.equal(f.frames.size, 0, 'late disconnected observations cannot schedule work');
  view.dispose(); assert.equal(view.captureAutomatic('desktop'), null);
});

test('only safe insets and visual viewport offsets constrain the canvas edges', () => {
  const f = fixture(); const safe = { top: 10, bottom: 20, left: 30, right: 40 };
  f.window.getComputedStyle = () => ({ getPropertyValue: key => String(safe[key.replace('--layout-safe-', '')]) });
  f.window.visualViewport = { width: 500, height: 300, offsetLeft: 5, offsetTop: 7 };
  assert.deepEqual(measureLayoutSurface(f.document, f.window), { x: 35, y: 17, width: 430, height: 270 });
});

test('edit root and panel visibility or dimensions never reserve space or own a view observer', () => {
  const f = fixture(); const chrome = { hidden: false, getBoundingClientRect: () => ({ bottom: 500 }) };
  f.nodes.set('layout-toolbar', chrome); f.nodes.set('layout-details', chrome);
  const view = createDashboardLayoutView(f); const before = view.frame('desktop');
  assert.equal(view.destination().y, 0); assert.ok(!f.observers[0].nodes.includes(chrome));
  for (const hidden of [true, false]) { chrome.hidden = hidden; chrome.getBoundingClientRect = () => ({ bottom: 1000 }); assert.deepEqual(view.frame('desktop'), before); }
  f.nodes.get('tools').rect.bottom = 900; assert.equal(view.destination().y, 0); view.dispose();
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
  view.update(state); assert.equal(f.nodes.get('widget-surface').hidden, true); assert.ok(view.destination().width > 0);
  for (let i = 0; i < 10; i++) f.observers[0].fn(); assert.equal(f.frames.size, 1);
  const fn = [...f.frames.values()][0]; f.frames.clear(); fn(); assert.equal(measurements, 2);
  f.listeners.get('resize')(); assert.equal(f.frames.size, 1);
  view.dispose(); assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0); assert.equal(f.observers[0].nodes.length, 0);
  fn(); assert.equal(measurements, 2, 'late frame cannot update a disposed view');
});

test('destination fitting never rebases reference geometry and Automatic clears the transform', () => {
  const f = fixture(); const view = createDashboardLayoutView(f);
  const state = { layout: { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop') }, mobile: false, scale: 1, display: { content: true } };
  view.update(state); const reference = view.reference('desktop'); const width = f.nodes.get('clock').style.width;
  assert.equal(reference.width, 1600); assert.equal(reference.height, 1000);
  f.window.innerWidth = 800; f.window.innerHeight = 400; view.update(state);
  assert.equal(view.reference('desktop'), reference); assert.equal(f.nodes.get('clock').style.width, width);
  const stage = f.nodes.get('widget-surface');
  assert.equal(stage.style.width, '1600px'); assert.equal(stage.style.transform, 'scale(0.4)');
  assert.equal(stage.style.top, '-600px'); assert.equal(stage.style.transformOrigin, 'left bottom');
  view.update({ ...state, layout: defaultWidgetLayout() });
  assert.equal(stage.style.transform, undefined); assert.equal(stage.style.transformOrigin, undefined); view.dispose();
});

test('fullscreen confirmation is bounded, ignores exit callbacks, and queues behind edit lock', () => {
  const f = fixture(); const view = createDashboardLayoutView(f); const original = view.reference('desktop');
  const flush = () => { const pending = [...f.frames.values()]; f.frames.clear(); for (const fn of pending) fn(); };
  view.lockReference(); f.document.fullscreenElement = f.document.documentElement;
  f.listeners.get('document:fullscreenchange')(); flush();
  f.window.innerWidth = 1500; f.window.innerHeight = 900;
  for (let i = 0; i < 15; i++) flush();
  assert.equal(f.frames.size, 0); assert.equal(view.reference('desktop'), original);
  view.releaseReference(); assert.equal(view.reference('desktop').width, 1500); assert.equal(view.reference('desktop').source, 'confirmed');
  f.document.fullscreenElement = null; f.listeners.get('document:fullscreenchange')(); flush();
  f.window.innerWidth = 800; f.listeners.get('resize')(); flush(); assert.equal(view.reference('desktop').width, 1500);
  f.document.fullscreenElement = f.document.documentElement; f.listeners.get('document:fullscreenchange')();
  const late = [...f.frames.values()][0]; view.dispose(); late();
  assert.equal(view.reference('desktop').width, 1500); assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
});

test('local override stays isolated from remote updates, pins its profile, and clears to latest confirmed state', () => {
  const f = fixture(); const view = createDashboardLayoutView(f);
  const state = { layout: defaultWidgetLayout(), mobile: false, scale: 1, display: { content: true } };
  view.update(state); view.lockReference(); const reference = view.reference('mobile');
  const profile = initialWidgetProfile('mobile'); view.setOverride({ mode: 'mobile', profile });
  assert.equal(f.nodes.get('widget-surface').style.width, `${reference.width}px`);
  const width = f.nodes.get('clock').style.width;
  view.update({ ...state, layout: { ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop', 'right') } });
  assert.equal(f.nodes.get('clock').style.width, width); assert.equal(state.layout.desktop, null);
  const frame = view.frame('mobile'); assert.equal(frame.reference, reference); assert.ok(frame.fit.scale > 0);
  view.setOverride(null); view.releaseReference(); assert.equal(f.nodes.get('clock').style.left, '1083px'); view.dispose();
});

test('rapid fullscreen exit invalidates a provisional sample before it can confirm', () => {
  const f = fixture(); const view = createDashboardLayoutView(f); const original = view.reference('desktop');
  const flush = () => { const pending = [...f.frames.values()]; f.frames.clear(); for (const fn of pending) fn(); };
  f.document.fullscreenElement = f.document.documentElement; f.listeners.get('document:fullscreenchange')(); flush();
  f.document.fullscreenElement = null; f.listeners.get('document:fullscreenchange')(); flush(); flush();
  assert.equal(view.reference('desktop'), original); assert.equal(f.frames.size, 0); view.dispose();
});

test('keyboard and pinch observations cannot confirm and ordinary post-entry resizes cannot rebase', () => {
  const f = fixture(); const view = createDashboardLayoutView(f);
  const flush = () => { const pending = [...f.frames.values()]; f.frames.clear(); for (const fn of pending) fn(); };
  f.window.visualViewport = { height: 400, scale: 1, removeEventListener() {} };
  f.document.activeElement.matches = () => true;
  f.document.fullscreenElement = f.document.documentElement; f.listeners.get('document:fullscreenchange')();
  for (let i = 0; i < 12; i++) flush();
  assert.equal(view.reference('desktop').source, 'estimated');
  f.window.visualViewport.height = 800; f.window.visualViewport.scale = 2;
  f.listeners.get('document:fullscreenchange')(); for (let i = 0; i < 12; i++) flush();
  assert.equal(view.reference('desktop').source, 'estimated');
  f.window.visualViewport.scale = 1; f.listeners.get('document:fullscreenchange')(); for (let i = 0; i < 12; i++) flush();
  assert.equal(view.reference('desktop').source, 'confirmed'); const reference = view.reference('desktop');
  f.window.innerHeight = 400; f.listeners.get('resize')(); flush(); assert.equal(view.reference('desktop'), reference); view.dispose();
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
