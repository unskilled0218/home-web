import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWidgetLayout, defaultWidgetLayout, initialWidgetProfile, projectWidget, editWidget, changeWidgetLayer, LAYOUT_UNITS } from '../public/dashboard-layout.js';
import { normalizeDashboardPreferences, validateDashboardPreferences, decodeStoredDashboardPreferences } from '../public/dashboard-helpers.js';

const surface = { width: 800, height: 800 };
function sample() {
  const profile = initialWidgetProfile('desktop');
  profile.items[0] = { id: 'calendar', x: 600000, y: 600000, w: 100000, h: 100000 };
  return profile;
}

test('layout defaults preserve automatic profiles and canonical normalization preserves layer order', () => {
  assert.deepEqual(normalizeWidgetLayout(defaultWidgetLayout()), { version: 1, desktop: null, mobile: null });
  for (const mode of ['desktop', 'mobile']) for (const position of ['left', 'right']) {
    const layout = { ...defaultWidgetLayout(), [mode]: initialWidgetProfile(mode, position) };
    assert.deepEqual(normalizeWidgetLayout(layout), layout);
    assert.notEqual(normalizeWidgetLayout(layout)[mode], layout[mode]);
  }
});

const malformed = {
  'unknown version': value => { value.version = 2; },
  'missing profile': value => { delete value.mobile; },
  'extra envelope field': value => { value.zIndex = 5; },
  'missing widget': value => { value.desktop.items.pop(); },
  'duplicate widget': value => { value.desktop.items[0] = value.desktop.items[1]; },
  'unknown identity': value => { value.desktop.items[0].id = 'photos'; },
  'extra geometry field': value => { value.desktop.items[0].z = 4; },
  'negative position': value => { value.desktop.items[0].x = -1; },
  'fractional units': value => { value.desktop.items[0].x = 0.5; },
  'infinity': value => { value.desktop.items[0].w = Infinity; },
  'NaN': value => { value.desktop.items[0].h = NaN; },
  'zero size': value => { value.desktop.items[0].w = 0; },
  'out of bounds': value => { value.desktop.items[0].w = LAYOUT_UNITS; },
  'null present layout': value => { value.desktop = undefined; }
};
for (const [scenario, mutate] of Object.entries(malformed)) test(`layout rejects ${scenario}`, () => {
  const layout = { ...defaultWidgetLayout(), desktop: sample() }; mutate(layout);
  assert.throws(() => normalizeWidgetLayout(layout));
});

test('all layer actions reorder only records, preserve geometry, and stop at boundaries', () => {
  const profile = sample(); const original = structuredClone(profile);
  for (const action of ['forward', 'backward', 'front', 'back']) {
    const next = changeWidgetLayer(profile, 'weather', action);
    for (const item of profile.items) assert.deepEqual(next.items.find(other => other.id === item.id), item);
  }
  const front = changeWidgetLayer(profile, 'weather', 'front'); assert.equal(front.items.at(-1).id, 'weather');
  assert.equal(changeWidgetLayer(front, 'weather', 'front'), front);
  const back = changeWidgetLayer(profile, 'weather', 'back'); assert.equal(back.items[0].id, 'weather');
  assert.equal(changeWidgetLayer(back, 'weather', 'backward'), back);
  assert.deepEqual(profile, original);
  assert.throws(() => changeWidgetLayer(profile, 'weather', 'up'));
});

test('overlap is intentional and a move never relocates other widgets', () => {
  const profile = sample();
  const next = editWidget(profile, 'calendar', { x: 0, y: 0 }, surface);
  assert.deepEqual(next.items.slice(1), profile.items.slice(1));
  assert.equal(next.items[0].x, 0); assert.equal(next.items[0].y, 0);
});

test('minimum-clamped moves preserve saved width and height across different surfaces', () => {
  let profile = sample(); const original = structuredClone(profile);
  assert.equal(projectWidget(profile.items[0], { width: 1600, height: 1600 }).w, 160);
  assert.equal(projectWidget(profile.items[0], surface).w, 100);
  for (let index = 0; index < 100; index++) profile = editWidget(profile, 'calendar', { x: index % 2 ? 300 : 400, y: index % 2 ? 350 : 450 }, surface);
  assert.equal(profile.items[0].w, 100000); assert.equal(profile.items[0].h, 100000);
  assert.equal(projectWidget(profile.items[0], { width: 1600, height: 1600 }).w, 160);
  assert.deepEqual(profile.items.slice(1), original.items.slice(1));
});

test('single-field edits preserve unrelated dimensions and perform only necessary same-axis containment', () => {
  const profile = sample(); const before = profile.items[0];
  for (const [key, value] of Object.entries({ x: 300, y: 300, w: 200, h: 200 })) {
    const after = editWidget(profile, 'calendar', { [key]: value }, surface).items[0];
    for (const field of ['x', 'y', 'w', 'h'].filter(field => field !== key)) assert.equal(after[field], before[field], `${key} retains ${field}`);
  }
  const next = editWidget(profile, 'calendar', { w: 800 }, surface).items[0];
  assert.equal(next.w, LAYOUT_UNITS); assert.equal(next.x, 0); assert.equal(next.h, before.h); assert.equal(next.y, before.y);
});

test('projected no-op and outward-clamped position edits retain exact original items', () => {
  const profile = sample(); profile.items[0].x = 900000; profile.items[0].y = 900000;
  const before = structuredClone(profile); const rect = projectWidget(profile.items[0], surface);
  assert.equal(rect.x, 700);
  assert.equal(editWidget(profile, 'calendar', { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, surface), profile);
  assert.equal(editWidget(profile, 'calendar', { x: 10000, y: 10000 }, surface), profile);
  assert.deepEqual(profile, before);
});

test('projection is bounded, non-mutating, and handles tiny and unavailable surfaces', () => {
  const profile = sample(); const before = structuredClone(profile);
  for (const area of [{ width: 40, height: 60 }, { width: 800, height: 420 }, { width: 1600, height: 900 }]) for (const item of profile.items) {
    const rect = projectWidget(item, area);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= area.width && rect.y + rect.h <= area.height);
    assert.ok(rect.w >= Math.min(100, area.width) && rect.h >= Math.min(100, area.height));
  }
  for (const area of [{ width: 0, height: 10 }, { width: 10, height: NaN }]) { assert.equal(projectWidget(profile.items[0], area), null); assert.equal(editWidget(profile, 'calendar', { x: 10 }, area), profile); }
  assert.deepEqual(profile, before);
  assert.throws(() => editWidget(profile, 'calendar', { z: 2 }, surface));
  assert.throws(() => editWidget(profile, 'calendar', { x: Infinity }, surface));
});

test('pixel edits round-trip within one pixel and do not alter the other axis', () => {
  const profile = sample();
  for (const width of [101, 137, 250, 799]) {
    const next = editWidget(profile, 'calendar', { w: width }, surface);
    assert.ok(Math.abs(projectWidget(next.items[0], surface).w - width) <= 1);
    assert.equal(next.items[0].h, profile.items[0].h); assert.equal(next.items[0].y, profile.items[0].y);
  }
});

test('old stored preferences gain only automatic layout; invalid present data and incomplete writes fail', () => {
  const preferences = normalizeDashboardPreferences({ scale: 1.2, mobileTimeVisible: false });
  const old = { ...preferences }; delete old.widgetLayout;
  assert.deepEqual(decodeStoredDashboardPreferences(old), preferences);
  assert.throws(() => validateDashboardPreferences(old), /Reload this page/);
  assert.throws(() => decodeStoredDashboardPreferences({ ...old, widgetLayout: null }));
  const configured = { ...preferences, widgetLayout: { ...defaultWidgetLayout(), desktop: sample() } };
  assert.deepEqual(validateDashboardPreferences(configured), configured);
});
