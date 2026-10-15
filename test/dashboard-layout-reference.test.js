import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutReference, layoutDimensions } from '../public/dashboard-layout-reference.js';
import { fitLayoutCanvas } from '../public/dashboard-layout.js';

const snapshot = (overrides = {}) => ({ screen: { width: 1600, height: 1000, orientation: 'landscape-primary:0' }, viewport: { width: 1200, height: 800 }, safe: { top: 2, bottom: 3, left: 4, right: 5 }, ...overrides });

test('screen estimates use CSS dimensions, fixed reservations, and independent profile margins', () => {
  const owner = createLayoutReference(); const value = snapshot(); const before = structuredClone(value); owner.refresh(value);
  assert.deepEqual(layoutDimensions({ width: 1600.9, height: 1000.1 }), { width: 1600, height: 1000 });
  assert.deepEqual([owner.get('desktop').width, owner.get('desktop').height], [1559, 875]);
  assert.deepEqual([owner.get('mobile').width, owner.get('mobile').height], [1575, 891]);
  assert.equal(owner.get('desktop').source, 'estimated');
  const original = owner.get('desktop'); owner.refresh(snapshot({ viewport: { width: 600, height: 400 }, safe: {} }));
  assert.equal(owner.get('desktop'), original, 'ordinary resize and destination insets cannot rebase reference');
  assert.deepEqual(value, before);
});

test('invalid screen dimensions use one stable viewport fallback or safely defer', () => {
  for (const screen of [undefined, { width: 0, height: 2 }, { width: NaN, height: 2 }, { width: Infinity, height: 2 }, { width: 1e20, height: 2 }, { width: '1600', height: 1000 }]) {
    const owner = createLayoutReference(); owner.refresh(snapshot({ screen }));
    assert.equal(owner.get('desktop').source, 'fallback'); assert.equal(owner.get('desktop').width, 1159);
    owner.refresh(snapshot({ screen, viewport: { width: 400, height: 300 } })); assert.equal(owner.get('desktop').width, 1159);
  }
  const owner = createLayoutReference(); owner.refresh({}); assert.equal(owner.get('desktop').width, 0);
  owner.refresh(snapshot()); assert.equal(owner.get('desktop').source, 'estimated');
});

test('fullscreen confirmation persists through exit and corrects an estimate without cumulative drift', () => {
  const owner = createLayoutReference(); owner.refresh(snapshot());
  const confirmed = snapshot({ viewport: { width: 1500, height: 900 } }); owner.confirm(confirmed);
  const reference = owner.get('desktop'); assert.equal(reference.width, 1459); assert.equal(reference.source, 'confirmed');
  owner.refresh(snapshot()); assert.equal(owner.get('desktop'), reference);
  for (let i = 0; i < 10; i++) owner.confirm(confirmed);
  assert.deepEqual(owner.get('desktop'), reference);
  owner.confirm(snapshot({ viewport: { width: 0, height: 0 } })); assert.deepEqual(owner.get('desktop'), reference);
});

test('Settings locks both entries while the latest context and confirmation wait for release', () => {
  const owner = createLayoutReference(); owner.refresh(snapshot()); const old = owner.get('desktop'); const mobile = owner.get('mobile'); owner.lock();
  const changed = snapshot({ screen: { width: 1000, height: 1600, orientation: 'portrait-primary:90' }, viewport: { width: 950, height: 1500 } });
  owner.refresh(changed); owner.confirm(changed); owner.refresh(changed);
  assert.equal(owner.get('desktop'), old); assert.equal(owner.get('mobile'), mobile);
  owner.release(); assert.equal(owner.get('desktop').width, 909); assert.equal(owner.get('desktop').source, 'confirmed');
  const accepted = owner.get('desktop'); owner.release(); assert.equal(owner.get('desktop'), accepted);
  owner.refresh(snapshot()); assert.equal(owner.get('desktop').source, 'estimated');
});

test('explicit orientation changes invalidate an unavailable-screen fallback, not ordinary resize', () => {
  const owner = createLayoutReference(); const value = snapshot({ screen: null }); owner.refresh(value);
  owner.refresh({ ...value, viewport: { width: 800, height: 1200 } }, { orientationChanged: true });
  assert.equal(owner.get('desktop').width, 759);
});

test('uniform fitting anchors bottom-left, caps enlargement, and rejects unavailable space', () => {
  const reference = { width: 1000, height: 500 }; const before = structuredClone(reference);
  for (const destination of [{ x: 16, y: 80, width: 500, height: 500 }, { x: 5, y: 7, width: 1000, height: 125 }, { x: 0, y: 0, width: 2000, height: 2000 }, { x: 8, y: 8, width: 1, height: 1 }]) {
    const fit = fitLayoutCanvas(reference, destination);
    assert.equal(fit.width / reference.width, fit.height / reference.height);
    assert.equal(fit.x, destination.x); assert.equal(fit.y + fit.height, destination.y + destination.height);
    assert.ok(fit.scale <= 1 && fit.width <= destination.width && fit.height <= destination.height);
  }
  for (const width of [0, -1, NaN, Infinity]) assert.equal(fitLayoutCanvas(reference, { x: 0, y: 0, width, height: 100 }), null);
  assert.equal(fitLayoutCanvas({ width: 0, height: 1 }, { x: 0, y: 0, width: 100, height: 100 }), null);
  assert.deepEqual(reference, before);
});
