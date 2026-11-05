import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { dashboardDisplay, applyDashboardDisplay } from '../public/dashboard-display.js';

const sections = ['time', 'weather', 'calendar', 'bookmarks', 'homeAssistant', 'wol'];
const allHidden = Object.fromEntries(sections.flatMap((name) => [[`${name}Visible`, false], [`mobile${name[0].toUpperCase()}${name.slice(1)}Visible`, false]]));

test('every fullscreen hide mask combines with each active profile without mutating preferences', () => {
  for (const mobile of [false, true]) for (let mask = 0; mask < 64; mask++) {
    const hide = Object.fromEntries(sections.map((name, index) => [`hide${name[0].toUpperCase()}${name.slice(1)}Fullscreen`, Boolean(mask & (1 << index))]));
    const settings = normalizeDashboardPreferences(hide); const before = structuredClone(settings);
    const normal = dashboardDisplay(settings, { mobile });
    const view = dashboardDisplay(settings, { mobile, fullscreen: true });
    for (const [index, name] of sections.entries()) {
      assert.equal(normal[`${name}Visible`], true, `${name} outside fullscreen`);
      assert.equal(view[`${name}Visible`], !(mask & (1 << index)), `${name}, mobile=${mobile}, mask=${mask}`);
      const key = `${mobile ? `mobile${name[0].toUpperCase()}${name.slice(1)}` : name}Visible`;
      for (const fullscreen of [false, true]) assert.equal(dashboardDisplay({ ...settings, [key]: false }, { mobile, fullscreen })[`${name}Visible`], false, `${name} stays disabled`);
    }
    const groups = Number(view.information) + Number(view.devices) + Number(view.bookmarksVisible);
    assert.equal((view.columns.match(/minmax|clamp/g) ?? []).length, groups);
    assert.equal(view.devices, view.homeAssistantVisible || view.wolVisible);
    assert.equal(view.content, mask !== 63); assert.equal(view.backgroundOnly, mask === 63);
    const caption = dashboardDisplay(settings, { mobile, fullscreen: true, caption: true });
    assert.equal(caption.information, true); assert.equal(caption.content, true); assert.equal(caption.backgroundOnly, mask === 63);
    assert.deepEqual(settings, before);
  }
});

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

test('hidden images suppress captions and caption-only tracks across mobile and fullscreen without changing widgets', () => {
  for (const mobile of [false, true]) for (const fullscreen of [false, true]) for (const caption of [false, true]) {
    const settings = normalizeDashboardPreferences({ imageInfo: true });
    const shown = dashboardDisplay(settings, { mobile, fullscreen, caption });
    const hidden = dashboardDisplay({ ...settings, imageVisible: false, mobileImageVisible: false }, { mobile, fullscreen, caption });
    assert.equal(hidden.imageVisible, false); assert.equal(hidden.captionVisible, false);
    for (const name of sections) assert.equal(hidden[`${name}Visible`], shown[`${name}Visible`], name);
    const captionOnly = dashboardDisplay(normalizeDashboardPreferences({ ...allHidden, imageVisible: false }), { mobile, fullscreen, caption });
    assert.equal(captionOnly.information, false); assert.equal(captionOnly.content, false); assert.equal(captionOnly.columns, ''); assert.equal(captionOnly.backgroundOnly, true);
  }
});

test('image DOM visibility stays hidden through caption callbacks and restores current presentation without mutating preferences', () => {
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { style: { setProperty() {} } }); return nodes.get(id); }, body: { classList: { toggle() {} } } };
  const settings = normalizeDashboardPreferences({ ...allHidden, imageVisible: false, imageInfo: true }); const before = structuredClone(settings);
  for (const caption of [true, false, true]) {
    applyDashboardDisplay(document, dashboardDisplay(settings, { caption }));
    assert.equal(nodes.get('photos').hidden, true); assert.equal(nodes.get('photo-caption').hidden, true); assert.equal(nodes.get('information').hidden, true);
  }
  applyDashboardDisplay(document, dashboardDisplay({ ...settings, imageVisible: true }, { caption: true }));
  assert.equal(nodes.get('photos').hidden, false); assert.equal(nodes.get('photo-caption').hidden, false); assert.equal(nodes.get('information').hidden, false);
  assert.deepEqual(settings, before);
});

test('independent image profiles and fullscreen override project captions without mutating settings', () => {
  for (const imageVisible of [false, true]) for (const mobileImageVisible of [false, true]) for (const hideImageFullscreen of [false, true]) {
    const settings = normalizeDashboardPreferences({ ...allHidden, imageVisible, mobileImageVisible, hideImageFullscreen }); const before = structuredClone(settings);
    for (const mobile of [false, true]) for (const fullscreen of [false, true, false]) {
      const expected = (mobile ? mobileImageVisible : imageVisible) && !(fullscreen && hideImageFullscreen);
      const view = dashboardDisplay(settings, { mobile, fullscreen, caption: true });
      assert.equal(view.imageVisible, expected, JSON.stringify({ mobile, fullscreen, imageVisible, mobileImageVisible, hideImageFullscreen }));
      assert.equal(view.captionVisible, expected); assert.equal(view.content, expected); assert.equal(view.information, expected);
      assert.equal(view.backgroundOnly, true); assert.deepEqual(settings, before);
    }
  }
});
