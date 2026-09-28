import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutModeOwner, MOBILE_LAYOUT_QUERY } from '../public/home-responsive.js';

function fixture(matches, onChange = () => {}) {
  let listener; let removed = 0; const media = { matches, addEventListener(type, callback) { assert.equal(type, 'change'); listener = callback; }, removeEventListener(type, callback) { assert.equal(type, 'change'); assert.equal(callback, listener); removed++; } };
  const modes = []; const owner = createLayoutModeOwner({ matchMediaImpl(query) { assert.equal(query, MOBILE_LAYOUT_QUERY); return media; }, onChange(mode) { modes.push(mode); onChange(mode); } });
  return { owner, modes, change(next) { media.matches = next; listener({ matches: next }); }, get removed() { return removed; } };
}

test('selects mobile before first render and emits only real breakpoint transitions', () => {
  const f = fixture(true); assert.equal(f.owner.getMode(), 'mobile'); assert.deepEqual(f.modes, []);
  f.change(true); assert.deepEqual(f.modes, []); f.change(false); assert.equal(f.owner.getMode(), 'desktop'); assert.deepEqual(f.modes, ['desktop']);
  f.change(false); f.change(true); assert.deepEqual(f.modes, ['desktop', 'mobile']); f.owner.dispose(); assert.equal(f.removed, 1);
});

test('responsive composition selects distinct saved arrays without writing or deriving geometry', () => {
  const settings = { layouts: { desktop: [{ id: 'time', x: 8, y: 0, w: 4, h: 3 }], mobile: [{ id: 'weather', x: 0, y: 12, w: 4, h: 6 }] } };
  const rendered = []; const render = (mode) => rendered.push(structuredClone(settings.layouts[mode])); const f = fixture(true, render);
  render(f.owner.getMode()); const original = structuredClone(settings);
  f.change(false); f.change(true);
  assert.deepEqual(rendered.map((items) => items[0].id), ['weather', 'time', 'weather']); assert.deepEqual(settings, original); f.owner.dispose();
});
