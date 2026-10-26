import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticWidgetPixels, captureAutomaticLayout, layoutInputIntent, layoutInputRange } from '../public/dashboard-layout-automatic.js';
import { normalizeWidgetLayout, projectWidget, initialWidgetProfile } from '../public/dashboard-layout.js';

const frame = { reference: { width: 1000, height: 800 }, fit: { x: 30, y: 50, scale: .5 } };

test('Automatic observations invert fitted bottom-left coordinates without rounding or minimum clamping', () => {
  const rect = { left: 40.2, top: 445, width: 150.1, height: 20.2 };
  const observed = automaticWidgetPixels(rect, frame);
  assert.ok(Math.abs(observed.x - 20.4) < 1e-10); assert.ok(Math.abs(observed.y + 30.4) < 1e-10);
  assert.equal(observed.w, 300.2); assert.equal(observed.h, 40.4);
  const captured = captureAutomaticLayout({ time: rect }, frame, 'desktop', 'right');
  assert.deepEqual(captured.screen.time, rect); assert.deepEqual(captured.pixels.time, observed);
  assert.deepEqual(normalizeWidgetLayout({ version: 2, desktop: captured.profile, mobile: null }).desktop, captured.profile);
  assert.equal(projectWidget(captured.profile.items.find(item => item.id === 'time'), frame.reference).h, 100);
  assert.equal(projectWidget(captured.profile.items.find(item => item.id === 'time'), frame.reference).y, 0);
  assert.deepEqual(captured.profile.items.find(item => item.id === 'weather'), initialWidgetProfile('desktop', 'right').items.find(item => item.id === 'weather'));
});

test('Automatic overflow is bounded only in the candidate and missing/invalid rectangles use stable fallback records', () => {
  const captured = captureAutomaticLayout({ calendar: { left: -500, top: -1000, width: 3000, height: 5000 }, time: { left: 0, top: 0, width: 0, height: 20 }, weather: { left: NaN, top: 0, width: 2, height: 2 } }, frame, 'mobile');
  assert.equal(captured.pixels.calendar.w, 6000); assert.equal(Object.keys(captured.screen).length, 1);
  const rect = projectWidget(captured.profile.items[0], frame.reference); assert.deepEqual(rect, { id: 'calendar', x: 0, y: 0, w: 1000, h: 800 });
  assert.deepEqual(captured.profile.items[1], initialWidgetProfile('mobile').items[1]);
  for (const fit of [null, { ...frame.fit, scale: 0 }, { ...frame.fit, x: NaN }]) assert.equal(captureAutomaticLayout({}, { ...frame, fit }, 'desktop'), null);
  assert.equal(captureAutomaticLayout({}, { ...frame, reference: { width: 0, height: 10 } }, 'desktop'), null);
  assert.equal(automaticWidgetPixels(undefined, frame), null);
});

test('numeric intent recognizes displayed observations before applying separate Custom bounds', () => {
  for (const [text, baseline] of [['40', 40], ['40.0', 40], ['-30', -30], ['1500', 1500]]) assert.equal(layoutInputIntent(text, baseline), 'unchanged');
  for (const text of ['', ' ', 'Infinity', '40.4', 'NaN']) assert.equal(layoutInputIntent(text, 40), 'invalid');
  assert.equal(layoutInputIntent('41', 40), 'changed'); assert.equal(layoutInputIntent('100', 40), 'changed');
  const rect = { x: 0, y: 0, w: 200, h: 100 };
  assert.deepEqual(layoutInputRange('h', rect, frame.reference), { min: 100, max: 800 });
  assert.deepEqual(layoutInputRange('x', rect, frame.reference), { min: 0, max: 800 });
  assert.deepEqual(layoutInputRange('y', rect, frame.reference), { min: 0, max: 700 });
});
