import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHomeDevices, flattenCollections, groupHomeDevices, homeControlPresentation, homeMeasurementPresentation, isLatestRequest, restoreCollectionFocus, showDialogError, updateCollectionSelection } from '../public/app-helpers.js';

test('updates dialog-local errors without rebuilding controls', () => {
  const element = { textContent: '' };
  showDialogError(element, 'Invalid device');
  assert.equal(element.textContent, 'Invalid device');
});

test('updates collection controls in place and restores the matching focus target', () => {
  const controls = ['first', 'second'].map((key) => ({
    dataset: { collectionKey: key, collectionToken: `${key}-token` },
    classList: { toggle(_name, selected) { this.selected = selected; } },
    setAttribute(_name, value) { this.current = value; },
    focus() { this.focused = true; }
  }));
  const root = { querySelectorAll: () => controls };
  updateCollectionSelection(root, 'second-token');
  assert.equal(controls[0].classList.selected, false);
  assert.equal(controls[1].classList.selected, true);
  assert.equal(controls[1].current, 'true');
  assert.equal(restoreCollectionFocus(root, 'second'), true);
  assert.equal(controls[1].focused, true);
});

test('flattens nested collections in display order for eager bookmark loading', () => {
  const child = { name: 'Child', children: [] };
  const sibling = { name: 'Sibling', children: [] };
  const root = { name: 'Root', children: [child] };
  assert.deepEqual(flattenCollections([root, sibling]), [root, child, sibling]);
});

test('filters and groups Home Assistant devices without accepting stale responses', async () => {
  const devices = [
    { name: 'Desk lamp', area: 'Office', manufacturer: 'Hue', model: 'Light', measurements: [{ name: 'Temperature', value: '21.5', unit: '°C', deviceClass: 'temperature' }], controls: [{ name: 'Reading light' }] },
    { name: 'Outdoor monitor', area: null, manufacturer: 'Acme', model: 'Sensor' }
  ];
  assert.deepEqual(filterHomeDevices(devices, ' hue '), [devices[0]]);
  assert.deepEqual(filterHomeDevices(devices, 'sensor'), [devices[1]]);
  assert.deepEqual(filterHomeDevices(devices, 'reading'), [devices[0]]);
  assert.deepEqual(filterHomeDevices(devices, 'temperature'), [devices[0]]);
  assert.deepEqual(filterHomeDevices(devices, '°c'), [devices[0]]);
  assert.deepEqual(filterHomeDevices(devices, '21.5'), []);
  assert.deepEqual([...groupHomeDevices(devices).keys()], ['Office', 'Unassigned']);
  assert.equal(isLatestRequest(3, 3), true);
  assert.equal(isLatestRequest(4, 3), false);
  let generation = 1;
  let resolveOld;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; }).then((value) => { if (isLatestRequest(generation, 1)) return value; return 'ignored'; });
  generation = 2;
  const newResponse = Promise.resolve('new').then((value) => isLatestRequest(generation, 2) ? value : 'ignored');
  resolveOld('old');
  assert.equal(await newResponse, 'new');
  assert.equal(await oldResponse, 'ignored');
  assert.deepEqual(homeControlPresentation({ state: 'on', available: true }), { action: 'turn_off', disabled: false, pressed: true, text: 'Turn off' });
  assert.deepEqual(homeControlPresentation({ state: 'off', available: true }, true), { action: 'turn_on', disabled: true, pressed: false, text: 'Working…' });
  assert.equal(homeControlPresentation({ state: 'unavailable', available: false }).disabled, true);
  assert.deepEqual(homeMeasurementPresentation({ value: '21.5', unit: '°C', status: 'available' }), { text: '21.5', unit: '°C', unavailable: false });
  assert.deepEqual(homeMeasurementPresentation({ value: '7', status: 'available' }), { text: '7', unit: '', unavailable: false });
  assert.deepEqual(homeMeasurementPresentation({ value: null, status: 'unavailable' }), { text: 'Unavailable', unit: '', unavailable: true });
  assert.deepEqual(homeMeasurementPresentation({ value: null, status: 'unknown' }), { text: 'Unknown', unit: '', unavailable: true });
});
