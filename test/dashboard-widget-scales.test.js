import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSettings, normalizeDashboardPreferences, validateDashboardPreferences, decodeStoredDashboardPreferences, resolveDisplayPreferences, legacyDashboardPreferences } from '../public/dashboard-helpers.js';
import { validateLocalSettings, decodeStoredLocalSettings, validateSettingsTransfer } from '../public/dashboard-settings-data.js';
import { categoryPreferences, patchCategory, SETTINGS_CATEGORIES } from '../public/dashboard-settings-categories.js';

const keys = ['bookmarksScale', 'mobileBookmarksScale', 'homeAssistantScale', 'mobileHomeAssistantScale', 'wolScale', 'mobileWolScale'];
const omit = (value, removed = keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !removed.includes(key)));
const preferences = normalizeDashboardPreferences({ color: '#123456', seconds: false, bookmarkLinkSelections: [], temperature: 'fahrenheit' });
const local = { schema: 1, revision: 7, preferences, weatherLocation: { latitude: 51, longitude: 0, label: 'London' }, followGlobalPhotos: false };
const transfer = { format: 'home-web.global-settings', version: 1, preferences, weatherLocation: local.weatherLocation };

test('widget scales default independently, normalize finite values, and require canonical current writes', () => {
  for (const key of keys) {
    assert.equal(preferences[key], 1, key);
    assert.equal(normalizeSettings({ [key]: 9 })[key], 2);
    assert.equal(normalizeDashboardPreferences({ [key]: 1.25 })[key], 1.3);
    assert.equal(legacyDashboardPreferences({ [key]: .7 })[key], .7);
    for (const value of [.5, 1, 1.7, 2]) assert.equal(validateDashboardPreferences({ ...preferences, [key]: value })[key], value);
    for (const value of [null, '1', NaN, Infinity, .4, 2.1, 1.25]) assert.throws(() => validateDashboardPreferences({ ...preferences, [key]: value }), key);
    assert.throws(() => validateDashboardPreferences(omit(preferences, [key])), key);
  }
  const settings = normalizeDashboardPreferences(Object.fromEntries(keys.map((key, i) => [key, .5 + i / 10])));
  for (const [key, mobileKey] of [['bookmarksScale', 'mobileBookmarksScale'], ['homeAssistantScale', 'mobileHomeAssistantScale'], ['wolScale', 'mobileWolScale']]) {
    assert.equal(resolveDisplayPreferences(settings, false)[key], settings[key]); assert.equal(resolveDisplayPreferences(settings, true)[key], settings[mobileKey]);
  }
});

test('stored/import scale upgrades fill absent fields only and keep unrelated validation strict', () => {
  for (const removed of [keys, ['mobileWolScale'], ['bookmarksScale', 'homeAssistantScale']]) {
    const old = omit(preferences, removed); const original = JSON.stringify(old);
    assert.deepEqual(decodeStoredDashboardPreferences(old), preferences);
    assert.deepEqual(decodeStoredLocalSettings({ ...local, preferences: old }), local);
    assert.deepEqual(validateSettingsTransfer({ ...transfer, preferences: old }), transfer);
    assert.equal(JSON.stringify(old), original); assert.throws(() => validateLocalSettings({ ...local, preferences: old }));
  }
  for (const key of keys) for (const value of [null, '1', NaN, Infinity, .4, 2.1, 1.25]) {
    const invalid = { ...omit(preferences), [key]: value };
    assert.throws(() => decodeStoredDashboardPreferences(invalid));
    assert.throws(() => decodeStoredLocalSettings({ ...local, preferences: invalid }));
    assert.throws(() => validateSettingsTransfer({ ...transfer, preferences: invalid }));
  }
  for (const invalid of [null, [], {}, omit(preferences, ['seconds']), { ...preferences, extra: true }]) {
    assert.throws(() => decodeStoredLocalSettings({ ...local, preferences: invalid }));
    assert.throws(() => validateSettingsTransfer({ ...transfer, preferences: invalid }));
  }
  assert.throws(() => decodeStoredLocalSettings({ ...local, extra: true }));
  assert.throws(() => decodeStoredLocalSettings({ ...local, revision: -1 }));
  assert.throws(() => decodeStoredLocalSettings({ ...local, followGlobalPhotos: 'false' }));
  assert.throws(() => validateSettingsTransfer({ ...transfer, extra: true }));
  assert.throws(() => validateSettingsTransfer({ ...transfer, weatherLocation: { latitude: 1000 } }));
});

test('each scale belongs to exactly one category and controls use the existing native bounds', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const [id, fields] of [['bookmarks', keys.slice(0, 2)], ['home-assistant', keys.slice(2, 4)], ['wol', keys.slice(4, 6)]]) {
    const patch = Object.fromEntries(fields.map((key, i) => [key, i ? .8 : 1.7]));
    const saved = patchCategory(id, preferences, patch); assert.deepEqual(saved, { ...preferences, ...patch });
    for (const key of fields) {
      assert.deepEqual(Object.entries(SETTINGS_CATEGORIES).filter(([, category]) => category.keys.includes(key)).map(([name]) => name), [id]);
      assert.equal(categoryPreferences(id, saved)[key], patch[key]);
      assert.equal([...html.matchAll(new RegExp(`name="${key}"`, 'g'))].length, 1);
      assert.match(html, new RegExp(`<label>[^<]+<input name="${key}" form="preferences" type="number" min="0.5" max="2" step="0.1">`));
    }
  }
});
