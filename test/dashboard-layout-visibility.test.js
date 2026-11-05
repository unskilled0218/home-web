import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { visibleLayoutWidgets } from '../public/dashboard-layout-visibility.js';

test('layout eligibility maps all six widgets using the editing profile and fullscreen override only', () => {
  const mapping = { time: 'Time', weather: 'Weather', calendar: 'Calendar', bookmarks: 'Bookmarks', 'home-assistant': 'HomeAssistant', wol: 'Wol' };
  const defaults = normalizeDashboardPreferences();
  assert.deepEqual(visibleLayoutWidgets(defaults, 'desktop'), Object.keys(mapping));
  for (const [id, name] of Object.entries(mapping)) {
    const desktop = name[0].toLowerCase() + name.slice(1);
    const settings = normalizeDashboardPreferences({ [`${desktop}Visible`]: false, [`mobile${name}Visible`]: true, [`hide${name}Fullscreen`]: true });
    const before = structuredClone(settings);
    assert.equal(visibleLayoutWidgets(settings, 'desktop').includes(id), false, id);
    assert.equal(visibleLayoutWidgets(settings, 'mobile').includes(id), true, id);
    assert.equal(visibleLayoutWidgets(settings, 'mobile', true).includes(id), false, id);
    assert.equal(visibleLayoutWidgets({ ...settings, imageVisible: false, mobileImageVisible: false, hideImageFullscreen: true }, 'mobile').includes(id), true, id);
    assert.deepEqual(settings, before);
  }
});
