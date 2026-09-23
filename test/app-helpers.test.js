import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCollectionFocus, runBulkWake, selectedButtonState, showDialogError, summarizeWakeResults, updateCollectionSelection, updateSelection } from '../public/app-helpers.js';

test('summarizes complete, partial, and total Wake outcomes', () => {
  assert.deepEqual(summarizeWakeResults([{ status: 'fulfilled' }, { status: 'fulfilled' }]), { succeeded: 2, failed: 0, error: false, message: 'Wake packets sent to 2 device(s).' });
  assert.deepEqual(summarizeWakeResults([{ status: 'fulfilled' }, { status: 'rejected' }]), { succeeded: 1, failed: 1, error: true, message: '1 wake request(s) succeeded; 1 failed.' });
  assert.deepEqual(summarizeWakeResults([{ status: 'rejected' }, { status: 'rejected' }]), { succeeded: 0, failed: 2, error: true, message: 'All 2 wake request(s) failed.' });
});

test('runs concurrent Wake requests without swallowing rejections', async () => {
  const summary = await runBulkWake([{ id: 1 }, { id: 2 }], async ({ id }) => {
    if (id === 2) throw new Error('cooldown');
    return { message: 'sent' };
  });
  assert.deepEqual(summary, { succeeded: 1, failed: 1, error: true, message: '1 wake request(s) succeeded; 1 failed.' });
  assert.deepEqual(selectedButtonState(2, true), { disabled: true, text: 'Wake selected (2)' });
  assert.deepEqual(selectedButtonState(2, false), { disabled: false, text: 'Wake selected (2)' });
});

test('updates selection and dialog-local errors without rebuilding controls', () => {
  const selection = new Set();
  assert.equal(updateSelection(selection, 7, true), 1);
  assert.equal(selection.has(7), true);
  assert.equal(updateSelection(selection, 7, false), 0);
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
