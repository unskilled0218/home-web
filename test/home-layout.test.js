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
      assert.ok(settings.layouts[mode].every((other) => other.id === item.id || !overlaps(item, other)));
    }
  }
  assert.deepEqual(normalizeHomeSettings(settings), settings);
});

test('editing or emptying one layout preserves the other and shared preferences', () => {
  const settings = defaultHomeSettings(); const mobile = structuredClone(settings.layouts.mobile);
  settings.layouts.desktop = changeWidget(settings.layouts.desktop, 'time', { x: 9, y: 5, w: 8, h: 10 }, 'desktop');
  const changed = normalizeHomeSettings(settings);
  assert.deepEqual(changed.layouts.mobile, mobile);
  for (const item of changed.layouts.desktop) assert.ok(changed.layouts.desktop.every((other) => other.id === item.id || !overlaps(item, other)));
  settings.layouts.desktop = []; settings.preferences.temperature = 'fahrenheit';
  const empty = normalizeHomeSettings(settings); assert.deepEqual(empty.layouts.desktop, []); assert.deepEqual(empty.layouts.mobile, mobile); assert.equal(empty.preferences.temperature, 'fahrenheit');
  assert.equal(addWidget(empty.layouts.desktop, 'time', 'desktop').length, 1);
  const previous = structuredClone(changed.layouts.desktop); changed.layouts.mobile = changeWidget(mobile, 'weather', { h: 15 }, 'mobile'); assert.deepEqual(changed.layouts.desktop, previous);
});

test('rejects invalid identities, versions and shapes, and bounds geometry and selections', () => {
  for (const input of [null, [], {}, { ...defaultHomeSettings(), version: 2 }, { ...defaultHomeSettings(), revision: -1 }]) assert.throws(() => normalizeHomeSettings(input));
  const settings = defaultHomeSettings(); settings.layouts.desktop[0].w = 1000; settings.layouts.desktop[0].y = 9000; settings.layouts.desktop[0].h = -5;
  const item = normalizeHomeSettings(settings).layouts.desktop.find((entry) => entry.id === settings.layouts.desktop[0].id);
  assert.equal(item.w, 12); assert.ok(item.y <= 144); assert.equal(item.h, 3);
  settings.layouts.mobile.push(settings.layouts.mobile[0]); assert.throws(() => normalizeHomeSettings(settings));
  const bad = defaultHomeSettings(); bad.layouts.mobile[0].id = 'constructor'; assert.throws(() => normalizeHomeSettings(bad));
  bad.layouts.mobile = []; bad.widgetSettings['home-assistant'].selections = [{ id: 'd_' + 'a'.repeat(43), readings: ['control-token'] }]; assert.throws(() => normalizeHomeSettings(bad));
  bad.widgetSettings['home-assistant'].selections = []; bad.preferences.password = 'secret'; assert.equal('password' in normalizeHomeSettings(bad).preferences, false);
});
