import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { dashboardDisplay, applyDashboardDisplay } from '../public/dashboard-display.js';

const sections = ['time', 'weather', 'calendar', 'bookmarks', 'homeAssistant', 'wol'];
const allHidden = Object.fromEntries(sections.flatMap((name) => [[`${name}Visible`, false], [`mobile${name[0].toUpperCase()}${name.slice(1)}Visible`, false]]));

test('all overlay combinations project without empty tracks or profile mutation', () => {
  for (let mask = 0; mask < 64; mask++) for (const mobile of [false, true]) {
    const flags = Object.fromEntries(sections.map((name, index) => [`${mobile ? `mobile${name[0].toUpperCase()}${name.slice(1)}` : name}Visible`, Boolean(mask & (1 << index))]));
    const settings = normalizeDashboardPreferences({ ...allHidden, ...flags }); const before = structuredClone(settings);
    const view = dashboardDisplay(settings, { mobile });
    const groups = Number(view.information) + Number(view.devices) + Number(view.bookmarksVisible);
    assert.equal((view.columns.match(/minmax|clamp/g) ?? []).length, groups);
    assert.equal(view.content, mask !== 0); assert.equal(view.backgroundOnly, mask === 0);
    assert.equal((view.deviceRows.match(/minmax/g) ?? []).length, view.homeAssistantVisible && view.wolVisible ? 2 : 1);
    assert.deepEqual(settings, before);
  }
});

test('fullscreen is additive and caption keeps only its wrapper, not immersive tool hiding', () => {
  const settings = normalizeDashboardPreferences({ ...allHidden, bookmarksVisible: true, hideBookmarksFullscreen: true });
  assert.equal(dashboardDisplay(settings).bookmarksVisible, true);
  const fullscreen = dashboardDisplay(settings, { fullscreen: true, caption: true });
  assert.equal(fullscreen.bookmarksVisible, false); assert.equal(fullscreen.information, true); assert.equal(fullscreen.backgroundOnly, true);
  assert.equal(dashboardDisplay({ ...settings, bookmarksVisible: false }).bookmarksVisible, false);
});

test('repeated caption DOM application retains supplied settings and only touches DOM presentation', () => {
  const nodes = new Map(); const classes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { style: { setProperty() {} } }); return nodes.get(id); }, body: { classList: { toggle(key, value) { classes.set(key, value); } } } };
  const settings = normalizeDashboardPreferences(allHidden); const before = structuredClone(settings);
  for (const caption of [true, false, true, false]) {
    applyDashboardDisplay(document, dashboardDisplay(settings, { caption, fullscreen: true }));
    assert.equal(nodes.get('information').hidden, !caption);
    assert.equal(nodes.get('dashboard-content').hidden, !caption);
    assert.equal(classes.get('background-only'), true);
  }
  assert.deepEqual(settings, before);
});
