import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboardPreferences, validateDashboardPreferences, decodeStoredDashboardPreferences, legacyDashboardPreferences } from '../public/dashboard-helpers.js';
import { decodeStoredLocalSettings, validateLocalSettings, validateSettingsTransfer } from '../public/dashboard-settings-data.js';
import { createSettingsSync, SHARED_SETTINGS_KEY } from '../public/dashboard-settings-sync.js';

const preferences = normalizeDashboardPreferences({ color: '#123456', imageInfo: true, seconds: false, bookmarkLinkSelections: [] });
const local = { schema: 1, revision: 7, preferences, weatherLocation: { latitude: 51, longitude: 0, label: 'London' }, followGlobalPhotos: false };
const transfer = { format: 'home-web.global-settings', version: 1, preferences, weatherLocation: local.weatherLocation };
const withoutImageVisibility = () => { const old = { ...preferences }; delete old.imageVisible; return old; };

test('old image profiles inherit desktop visibility only when mobile is absent across every upgrade path', () => {
  for (const imageVisible of [false, true]) {
    const old = { ...preferences, imageVisible }; delete old.mobileImageVisible; delete old.hideImageFullscreen;
    const expected = { ...preferences, imageVisible, mobileImageVisible: imageVisible, hideImageFullscreen: false };
    const bytes = JSON.stringify(old);
    assert.deepEqual(normalizeDashboardPreferences(old), expected);
    assert.deepEqual(legacyDashboardPreferences(old), expected);
    assert.deepEqual(decodeStoredDashboardPreferences(old), expected);
    assert.deepEqual(decodeStoredLocalSettings({ ...local, preferences: old }).preferences, expected);
    assert.deepEqual(validateSettingsTransfer({ ...transfer, preferences: old }).preferences, expected);
    assert.deepEqual(decodeStoredDashboardPreferences({ ...old, hideImageFullscreen: true }), { ...expected, hideImageFullscreen: true });
    assert.deepEqual(decodeStoredDashboardPreferences({ ...old, mobileImageVisible: !imageVisible }), { ...expected, mobileImageVisible: !imageVisible });
    const client = createSettingsSync({ storage: { getItem: key => key === SHARED_SETTINGS_KEY ? JSON.stringify({ schema: 1, initialized: true, revision: 7, preferences: old }) : null, setItem: () => assert.fail('cache read must not write') }, onSnapshot() {}, fetchImpl: async () => { throw Error('offline'); } });
    try { assert.deepEqual(client.getState().snapshot.preferences, expected); assert.equal(client.getState().snapshot.revision, 7); } finally { client.dispose(); }
    assert.equal(JSON.stringify(old), bytes);
    assert.throws(() => validateDashboardPreferences(old));
    for (const mobileImageVisible of [false, true]) for (const hideImageFullscreen of [false, true]) {
      const explicit = { ...old, mobileImageVisible, hideImageFullscreen };
      assert.deepEqual(decodeStoredDashboardPreferences(explicit), explicit);
      assert.deepEqual(decodeStoredLocalSettings({ ...local, preferences: explicit }).preferences, explicit);
      assert.deepEqual(validateSettingsTransfer({ ...transfer, preferences: explicit }).preferences, explicit);
    }
    for (const key of ['mobileImageVisible', 'hideImageFullscreen']) for (const bad of [null, undefined, 'false', 0]) {
      const invalid = { ...old, [key]: bad };
      assert.throws(() => decodeStoredDashboardPreferences(invalid), key);
      assert.throws(() => decodeStoredLocalSettings({ ...local, preferences: invalid }), key);
      assert.throws(() => validateSettingsTransfer({ ...transfer, preferences: invalid }), key);
    }
  }
  const oldest = withoutImageVisibility(); delete oldest.mobileImageVisible; delete oldest.hideImageFullscreen;
  assert.deepEqual(decodeStoredDashboardPreferences(oldest), preferences);
  assert.deepEqual(validateSettingsTransfer({ ...transfer, preferences: oldest }).preferences, preferences);
});

test('image visibility upgrades only absent stored/import fields and preserves either explicit boolean', () => {
  const old = withoutImageVisibility(); const bytes = JSON.stringify(old);
  assert.deepEqual(decodeStoredDashboardPreferences(old), preferences);
  assert.deepEqual(decodeStoredLocalSettings({ ...local, preferences: old }), local);
  assert.deepEqual(validateSettingsTransfer({ ...transfer, preferences: old }), transfer);
  assert.deepEqual(legacyDashboardPreferences(old), preferences);
  assert.equal(JSON.stringify(old), bytes);
  assert.throws(() => validateDashboardPreferences(old));
  assert.throws(() => validateLocalSettings({ ...local, preferences: old }));
  for (const imageVisible of [false, true]) {
    const value = { ...preferences, imageVisible };
    assert.deepEqual(validateDashboardPreferences(value), value);
    assert.deepEqual(decodeStoredDashboardPreferences(value), value);
    assert.deepEqual(decodeStoredLocalSettings({ ...local, preferences: value }), { ...local, preferences: value });
    assert.deepEqual(validateSettingsTransfer({ ...transfer, preferences: value }), { ...transfer, preferences: value });
  }
});

test('image visibility compatibility rejects malformed present fields and unrelated missing or unknown data', () => {
  const missingSeconds = withoutImageVisibility(); delete missingSeconds.seconds;
  const invalid = [null, [], {}, missingSeconds, { ...withoutImageVisibility(), extra: true }, ...[null, 'false', 0, undefined].map(imageVisible => ({ ...preferences, imageVisible }))];
  for (const value of invalid) {
    assert.throws(() => decodeStoredDashboardPreferences(value));
    assert.throws(() => decodeStoredLocalSettings({ ...local, preferences: value }));
    assert.throws(() => validateSettingsTransfer({ ...transfer, preferences: value }));
  }
});

test('offline confirmed caches upgrade image visibility without changing bytes or revision', () => {
  for (const saved of [withoutImageVisibility(), { ...preferences, imageVisible: false }]) {
    const record = { schema: 1, initialized: true, revision: 7, preferences: saved }; const bytes = JSON.stringify(record); let writes = 0;
    const client = createSettingsSync({ storage: { getItem: key => key === SHARED_SETTINGS_KEY ? bytes : null, setItem: () => writes++ }, onSnapshot() {}, fetchImpl: async () => { throw Error('offline'); } });
    try {
      client.setVisible(false);
      assert.deepEqual(client.getState().snapshot.preferences, { ...preferences, imageVisible: saved.imageVisible ?? true });
      assert.equal(client.getState().snapshot.revision, 7); assert.equal(client.getState().cache, true); assert.equal(client.getState().confirmed, false);
      assert.equal(writes, 0); assert.equal(JSON.stringify(record), bytes);
    } finally { client.dispose(); }
  }
});
