import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultHomeSettings, normalizeHomeSettings, addWidget, changeWidget, overlaps, columns, layoutMode } from '../public/home-layout.js';

test('defaults provide independent bounded nonoverlapping desktop and mobile layouts', () => {
  const settings = defaultHomeSettings();
  assert.equal(settings.preferences.timezone, 'UTC');
  assert.equal(layoutMode(767), 'mobile'); assert.equal(layoutMode(768), 'desktop');
  for (const mode of ['desktop', 'mobile']) {
    assert.equal(settings.layouts[mode].length, 6);
    for (const item of settings.layouts[mode]) {
      assert.ok(item.x >= 0 && item.x + item.w <= columns(mode));
      if (mode === 'desktop') assert.ok(item.y >= 0 && item.y + item.h <= 12);
      assert.ok(settings.layouts[mode].every((other) => other.id === item.id || !overlaps(item, other)));
    }
  }
  assert.deepEqual(normalizeHomeSettings(settings), settings);
});

test('editing or emptying one layout preserves the other and shared preferences', () => {
  const settings = defaultHomeSettings(); const mobile = structuredClone(settings.layouts.mobile);
  settings.layouts.desktop = changeWidget(settings.layouts.desktop, 'time', { w: 2 }, 'desktop');
  const changed = normalizeHomeSettings(settings);
  assert.deepEqual(changed.layouts.mobile, mobile);
  for (const item of changed.layouts.desktop) assert.ok(changed.layouts.desktop.every((other) => other.id === item.id || !overlaps(item, other)));
  settings.layouts.desktop = []; settings.preferences.temperature = 'fahrenheit';
  const empty = normalizeHomeSettings(settings); assert.deepEqual(empty.layouts.desktop, []); assert.deepEqual(empty.layouts.mobile, mobile); assert.equal(empty.preferences.temperature, 'fahrenheit');
  assert.equal(addWidget(empty.layouts.desktop, 'time', 'desktop').length, 1);
  const previous = structuredClone(changed.layouts.desktop); changed.layouts.mobile = changeWidget(mobile, 'weather', { h: 15 }, 'mobile'); assert.deepEqual(changed.layouts.desktop, previous);
});

test('distinct desktop and mobile membership and geometry remain independent', () => {
  const settings = defaultHomeSettings(); settings.layouts.desktop = [{ id: 'time', type: 'time', x: 8, y: 9, w: 4, h: 3 }]; settings.layouts.mobile = [{ id: 'weather', type: 'weather', x: 0, y: 15, w: 4, h: 9 }];
  const normalized = normalizeHomeSettings(settings); const desktop = structuredClone(normalized.layouts.desktop);
  normalized.layouts.mobile = changeWidget(normalized.layouts.mobile, 'weather', { y: 2, h: 6 }, 'mobile');
  const changed = normalizeHomeSettings(normalized); assert.deepEqual(changed.layouts.desktop, desktop); assert.deepEqual(changed.layouts.mobile, [{ id: 'weather', type: 'weather', x: 0, y: 2, w: 4, h: 6 }]); assert.deepEqual(normalizeHomeSettings(changed), changed);
});

test('rejects invalid identities, versions and shapes, and bounds geometry and selections', () => {
  for (const input of [null, [], {}, { ...defaultHomeSettings(), version: 2 }, { ...defaultHomeSettings(), revision: -1 }]) assert.throws(() => normalizeHomeSettings(input));
  const settings = defaultHomeSettings(); settings.layouts.desktop[0].w = 1000; settings.layouts.desktop[0].y = 9000; settings.layouts.desktop[0].h = -5;
  const item = normalizeHomeSettings(settings).layouts.desktop.find((entry) => entry.id === settings.layouts.desktop[0].id);
  assert.ok(item.w <= 12); assert.ok(item.y + item.h <= 12); assert.equal(item.h, 3);
  settings.layouts.mobile.push(settings.layouts.mobile[0]); assert.throws(() => normalizeHomeSettings(settings));
  const bad = defaultHomeSettings(); bad.layouts.mobile[0].id = 'constructor'; assert.throws(() => normalizeHomeSettings(bad));
  bad.layouts.mobile = []; bad.widgetSettings['home-assistant'].selections = [{ id: 'd_' + 'a'.repeat(43), readings: ['control-token'] }]; assert.throws(() => normalizeHomeSettings(bad));
  bad.widgetSettings['home-assistant'].selections = []; bad.preferences.password = 'secret'; assert.equal('password' in normalizeHomeSettings(bad).preferences, false);
});

test('fits legacy desktop overflow without dropping widgets or changing mobile and remains idempotent', () => {
  const legacy = defaultHomeSettings(); const mobile = structuredClone(legacy.layouts.mobile);
  legacy.layouts.desktop = legacy.layouts.desktop.map((item, index) => ({ ...item, y: index * 25, h: 24, w: 12 }));
  const fitted = normalizeHomeSettings(legacy);
  assert.deepEqual(fitted.layouts.desktop.map((item) => item.id).sort(), legacy.layouts.desktop.map((item) => item.id).sort());
  for (const item of fitted.layouts.desktop) { assert.ok(item.y + item.h <= 12); assert.ok(fitted.layouts.desktop.every((other) => item.id === other.id || !overlaps(item, other))); }
  assert.deepEqual(fitted.layouts.mobile, mobile); assert.deepEqual(fitted.preferences, legacy.preferences); assert.deepEqual(normalizeHomeSettings(fitted), fitted);
  legacy.layouts.desktop = [{ id: 'weather', type: 'weather', x: 0, y: 100, w: 4, h: 3 }, { id: 'time', type: 'time', x: 0, y: 101, w: 4, h: 3 }];
  const ordered = normalizeHomeSettings(legacy).layouts.desktop;
  assert.equal(ordered.find((item) => item.id === 'weather').y, 9); assert.equal(ordered.find((item) => item.id === 'time').y, 0);
});

test('upward moves distinguish shared rows from real collisions and keep displacement bounded', () => {
  const items = [{ id: 'weather', type: 'weather', x: 4, y: 0, w: 4, h: 3 }, { id: 'time', type: 'time', x: 0, y: 6, w: 4, h: 3 }];
  const moved = changeWidget(items, 'time', { y: 0 }, 'desktop'); assert.equal(moved[0].y, 0); assert.deepEqual(moved[1], items[0]);
  const collided = changeWidget(items, 'time', { x: 4, y: 0 }, 'desktop');
  assert.equal(collided.find((item) => item.id === 'time').y, 0); assert.ok(!overlaps(...collided));
  for (const item of collided) assert.ok(item.y + item.h <= 12 && item.x + item.w <= 12);
});

test('impossible edits and additions return failure without mutating or shrinking the prior layout', () => {
  const items = defaultHomeSettings().layouts.desktop; const before = structuredClone(items);
  assert.equal(changeWidget(items, 'time', { h: 4 }, 'desktop'), null); assert.deepEqual(items, before);
  const full = [{ id: 'weather', type: 'weather', x: 0, y: 0, w: 12, h: 12 }]; assert.equal(addWidget(full, 'time', 'desktop'), null); assert.equal(full.length, 1);
});
