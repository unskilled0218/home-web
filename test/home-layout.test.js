import test from 'node:test';
import assert from 'node:assert/strict';
import { addWidget, changeWidget, defaultHomeSettings, layoutMode, MAX_CANVAS_SIZE, normalizeHomeSettings, overlaps, projectLayout } from '../public/home-layout.js';

function legacySettings() {
  const current = defaultHomeSettings();
  return {
    ...current,
    version: 1,
    layouts: {
      desktop: [['time', 0, 0, 4, 3], ['weather', 4, 0, 8, 6], ['calendar', 0, 3, 4, 6], ['bookmarks', 4, 6, 4, 6], ['home-assistant', 8, 6, 4, 6], ['wol', 0, 9, 4, 3]].map(([id, x, y, w, h]) => ({ id, type: id, x, y, w, h })),
      mobile: [['time', 0, 0, 4, 3], ['weather', 0, 3, 4, 6], ['calendar', 0, 9, 4, 6], ['bookmarks', 0, 15, 4, 6], ['home-assistant', 0, 21, 4, 6], ['wol', 0, 27, 4, 3]].map(([id, x, y, w, h]) => ({ id, type: id, x, y, w, h }))
    }
  };
}

function assertValid(layout) {
  for (const item of layout.items) {
    assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.w <= layout.canvas.width && item.y + item.h <= layout.canvas.height);
    assert.ok(layout.items.every((other) => other.id === item.id || !overlaps(item, other)));
  }
}

test('defaults provide independent bounded pixel layouts', () => {
  const settings = defaultHomeSettings();
  assert.equal(settings.version, 2); assert.equal(settings.preferences.timezone, 'UTC');
  assert.equal(layoutMode(767), 'mobile'); assert.equal(layoutMode(768), 'desktop');
  for (const mode of ['desktop', 'mobile']) { assert.equal(settings.layouts[mode].items.length, 6); assertValid(settings.layouts[mode]); }
  assert.deepEqual(normalizeHomeSettings(settings), settings);
});

test('one-pixel edits preserve the other layout and remain idempotent', () => {
  const settings = defaultHomeSettings(); const mobile = structuredClone(settings.layouts.mobile); const time = settings.layouts.desktop.items.find((item) => item.id === 'time');
  settings.layouts.desktop = changeWidget(settings.layouts.desktop, 'time', { w: time.w - 1 }, 'desktop');
  const changed = normalizeHomeSettings(settings); assert.equal(changed.layouts.desktop.items.find((item) => item.id === 'time').w, time.w - 1); assert.deepEqual(changed.layouts.mobile, mobile);
  changed.layouts.desktop = changeWidget(changed.layouts.desktop, 'time', { x: 1 }, 'desktop'); assert.equal(changed.layouts.desktop.items.find((item) => item.id === 'time').x, 1);
  assert.deepEqual(normalizeHomeSettings(changed), changed);
});

test('empty layouts and additions retain canvas metadata', () => {
  const settings = defaultHomeSettings(); const desktop = { ...settings.layouts.desktop, items: [] }; const added = addWidget(desktop, 'time', 'desktop');
  assert.deepEqual(added.canvas, desktop.canvas); assert.equal(added.items.length, 1); assertValid(added);
  settings.layouts.desktop = desktop; settings.preferences.temperature = 'fahrenheit'; const normalized = normalizeHomeSettings(settings);
  assert.deepEqual(normalized.layouts.desktop.items, []); assert.equal(normalized.preferences.temperature, 'fahrenheit');
});

test('projects rectangle edges deterministically across canvas sizes', () => {
  const source = { canvas: { width: 1000, height: 500 }, items: [{ id: 'time', type: 'time', x: 101, y: 51, w: 201, h: 101 }] };
  assert.deepEqual(projectLayout(source, { width: 500, height: 250 }, 'desktop'), { canvas: { width: 500, height: 250 }, items: [{ id: 'time', type: 'time', x: 51, y: 26, w: 100, h: 50 }] });
  assert.deepEqual(projectLayout(source, { width: 400, height: 1 }, 'mobile').canvas, { width: 400, height: 200 });
});

test('migrates version-one tracks to version-two pixels without changing shared state', () => {
  const legacy = legacySettings(); legacy.revision = 7; legacy.preferences.temperature = 'fahrenheit';
  const migrated = normalizeHomeSettings(legacy);
  assert.equal(migrated.version, 2); assert.equal(migrated.revision, 7); assert.equal(migrated.preferences.temperature, 'fahrenheit');
  assert.deepEqual(migrated.layouts.desktop.items.map((item) => item.id), legacy.layouts.desktop.map((item) => item.id));
  assertValid(migrated.layouts.desktop); assertValid(migrated.layouts.mobile); assert.deepEqual(normalizeHomeSettings(migrated), migrated);
});

test('legacy desktop overflow compacts without dropping widgets', () => {
  const legacy = legacySettings(); const ids = legacy.layouts.desktop.map((item) => item.id).sort(); legacy.layouts.desktop = legacy.layouts.desktop.map((item, index) => ({ ...item, y: index * 25, h: 24, w: 12 }));
  const migrated = normalizeHomeSettings(legacy); assert.deepEqual(migrated.layouts.desktop.items.map((item) => item.id).sort(), ids); assertValid(migrated.layouts.desktop); assert.deepEqual(normalizeHomeSettings(migrated), migrated);
});

test('bounds pixel geometry and rejects malformed version-two shapes', () => {
  const settings = defaultHomeSettings(); settings.layouts.desktop.items = [settings.layouts.desktop.items[0]]; const item = settings.layouts.desktop.items[0]; item.x = 9000; item.y = 9000; item.w = 1000; item.h = 1000;
  const normalized = normalizeHomeSettings(settings); assertValid(normalized.layouts.desktop);
  const duplicate = defaultHomeSettings(); duplicate.layouts.mobile.items.push(duplicate.layouts.mobile.items[0]); assert.throws(() => normalizeHomeSettings(duplicate));
  const bad = defaultHomeSettings(); bad.layouts.mobile.canvas.width = MAX_CANVAS_SIZE + 1; assert.throws(() => normalizeHomeSettings(bad));
  const fractional = defaultHomeSettings(); fractional.layouts.desktop.items[0].w = 100.5; assert.throws(() => normalizeHomeSettings(fractional));
  assert.throws(() => normalizeHomeSettings({ ...defaultHomeSettings(), version: 3 }));
});

test('collision relocation is deterministic and desktop placement grows downward', () => {
  const layout = { canvas: { width: 500, height: 300 }, items: [{ id: 'weather', type: 'weather', x: 250, y: 0, w: 250, h: 150 }, { id: 'time', type: 'time', x: 0, y: 150, w: 200, h: 100 }] };
  const moved = changeWidget(layout, 'time', { x: 250, y: 0 }, 'desktop'); assertValid(moved); assert.equal(moved.items.find((item) => item.id === 'time').x, 250); assert.equal(moved.items.find((item) => item.id === 'time').y, 0);
  const full = { canvas: { width: 320, height: 240 }, items: [{ id: 'weather', type: 'weather', x: 0, y: 0, w: 320, h: 240 }] }; const before = structuredClone(full); const added = addWidget(full, 'time', 'desktop');
  assert.deepEqual(full, before); assert.equal(added.items.find((item) => item.id === 'time').y, 240); assert.ok(added.canvas.height > full.canvas.height); assertValid(added);
});

test('mobile placement grows downward within its bounded pixel canvas', () => {
  const layout = { canvas: { width: 320, height: 240 }, items: [{ id: 'weather', type: 'weather', x: 0, y: 0, w: 320, h: 240 }] };
  const added = addWidget(layout, 'time', 'mobile'); assert.ok(added.canvas.height > layout.canvas.height); assertValid(added);
});
