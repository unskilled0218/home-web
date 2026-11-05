import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFERENCE_KEYS, normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { CATEGORY_IDS, SETTINGS_CATEGORIES, categoryScopes, categoryPreferences, composeCategoryPreferences, patchCategory } from '../public/dashboard-settings-categories.js';
import { validateCategoryScopes } from '../public/dashboard-settings-data.js';
import { createCategoryDrafts } from '../public/dashboard-settings-drafts.js';

test('eight categories own every canonical key exactly once and patches cannot cross boundaries', () => {
  const keys = Object.values(SETTINGS_CATEGORIES).flatMap(category => category.keys);
  assert.equal(CATEGORY_IDS.length, 8); assert.equal(new Set(keys).size, keys.length); assert.deepEqual(keys.sort(), [...PREFERENCE_KEYS].sort());
  const local = normalizeDashboardPreferences({ timezone: 'Asia/Tokyo', color: '#123456' });
  const global = normalizeDashboardPreferences({ timezone: 'Europe/London', color: '#abcdef', temperature: 'fahrenheit' });
  for (const id of CATEGORY_IDS) {
    const scopes = { ...categoryScopes(), [id]: 'global' }; const mixed = composeCategoryPreferences(scopes, local, global);
    assert.deepEqual(categoryPreferences(id, mixed), categoryPreferences(id, global));
    for (const other of CATEGORY_IDS.filter(other => other !== id)) assert.deepEqual(categoryPreferences(other, mixed), categoryPreferences(other, local));
    assert.deepEqual(patchCategory(id, local, categoryPreferences(id, global)), mixed);
    const foreign = Object.values(SETTINGS_CATEGORIES).find(category => category !== SETTINGS_CATEGORIES[id]).keys[0];
    assert.throws(() => patchCategory(id, local, { [foreign]: global[foreign] }), /category preference/);
  }
});

test('category map schemas reject missing/unknown modes, unsafe revisions, and embedded preferences', () => {
  const record = { schema: 1, revision: 1, scopes: categoryScopes() }; assert.deepEqual(validateCategoryScopes(record), record);
  for (const patch of [{ schema: 2 }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { preferences: {} }, { scopes: { ...record.scopes, time: 'mixed' } }, { scopes: { ...record.scopes, extra: 'local' } }]) assert.throws(() => validateCategoryScopes({ ...record, ...patch }));
  const missing = structuredClone(record); delete missing.scopes.weather; assert.throws(() => validateCategoryScopes(missing));
});

test('image visibility belongs only to Images and follows category scope without changing other values', () => {
  const local = normalizeDashboardPreferences({ imageVisible: false, color: '#123456' });
  const global = normalizeDashboardPreferences({ color: '#abcdef' });
  for (const key of ['imageVisible', 'mobileImageVisible', 'hideImageFullscreen']) {
    assert.deepEqual(Object.entries(SETTINGS_CATEGORIES).filter(([, category]) => category.keys.includes(key)).map(([id]) => id), ['images']);
    assert.throws(() => patchCategory('time', local, { [key]: true }), /category preference/);
    assert.equal(composeCategoryPreferences({ ...categoryScopes(), images: 'global' }, local, global)[key], global[key]);
  }
  assert.deepEqual(patchCategory('images', global, { imageVisible: false }), { ...global, imageVisible: false });
  assert.equal(composeCategoryPreferences({ ...categoryScopes(), time: 'global' }, local, global).imageVisible, false);
  assert.equal(composeCategoryPreferences({ ...categoryScopes(), images: 'global' }, local, global).imageVisible, true);
  assert.throws(() => patchCategory('time', local, { imageVisible: true }), /category preference/);
});

test('category drafts retain dirty baselines, opaque tokens and independent sessions until reload', () => {
  const drafts = createCategoryDrafts(); const state = { confirmed: true, source: 'opaque source', saveToken: 'opaque token', snapshot: { preferences: normalizeDashboardPreferences() } };
  drafts.load('time', state); drafts.load('weather', state); drafts.dirty('time');
  const changed = { ...state, source: 'other source', saveToken: 'new token' };
  assert.equal(drafts.observe('time', changed, true), null); assert.equal(drafts.get('time').token, 'opaque token'); assert.equal(drafts.stale('time', changed), true);
  drafts.observe('weather', changed, true); assert.equal(drafts.get('weather').token, 'new token'); assert.equal(drafts.anyDirty(), true);
  drafts.load('time', changed); assert.equal(drafts.anyDirty(), false); drafts.clear(); assert.equal(drafts.get('time'), undefined);
});
