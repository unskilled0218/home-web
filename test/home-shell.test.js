import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeShell } from '../public/home-shell.js';

function fixture() {
  const nodes = new Map(); const listeners = new Map(); let state = { settings: null, editing: false }; let prepared = 0; let loads = 0; let cancellations = 0; let gestureCancels = 0; let time = 1000; let rejectFullscreen = false;
  const element = () => ({ listeners: {}, open: false, disabled: false, addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }, async dispatch(type) { for (const callback of this.listeners[type] ?? []) await callback({}); }, showModal() { this.open = true; }, close() { this.open = false; void this.dispatch('close'); }, focus() { document.activeElement = this; } });
  const document = { activeElement: null, fullscreenEnabled: true, fullscreenElement: null, getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelector() { return [...nodes.values()].find((node) => node.open); }, addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); }, async exitFullscreen() { document.fullscreenElement = null; listeners.get('fullscreenchange')(); } };
  document.documentElement = { async requestFullscreen() { if (rejectFullscreen) throw new Error('Denied'); document.fullscreenElement = this; listeners.get('fullscreenchange')(); } };
  const settings = { getState: () => state, begin() { state = { ...state, editing: true }; }, cancel() { state = { ...state, editing: false }; cancellations++; }, async save() { state = { ...state, editing: false }; return true; }, load() { loads++; } };
  const shell = createHomeShell({ document, settings, prepareSettings: () => prepared++, cancelGesture: () => gestureCancels++, now: () => time });
  return { document, shell, settings, get state() { return state; }, set state(next) { state = next; }, get prepared() { return prepared; }, get loads() { return loads; }, get cancellations() { return cancellations; }, get gestureCancels() { return gestureCancels; }, set rejectFullscreen(value) { rejectFullscreen = value; }, set time(value) { time = value; }, node: (id) => document.getElementById(id), click: (id) => document.getElementById(id).dispatch('click'), escape: () => listeners.get('keydown')({ key: 'Escape' }) };
}

test('Settings and Retry remain reachable without loaded state, then Edit/Save/Cancel run from the dialog', async () => {
  const f = fixture(); await f.click('home-settings-open'); assert.equal(f.node('home-settings-dialog').open, true); assert.equal(f.prepared, 0);
  await f.click('home-retry'); assert.equal(f.loads, 1); await f.click('home-edit'); assert.equal(f.state.editing, false);
  f.state = { settings: {}, editing: false }; await f.click('home-settings-close'); await f.click('home-settings-open'); assert.equal(f.prepared, 1);
  await f.click('home-edit'); assert.equal(f.state.editing, true); assert.equal(f.node('home-settings-dialog').open, false); assert.equal(f.document.activeElement, f.node('home-settings-open'));
  await f.click('home-settings-open'); await f.click('home-dialog-save'); assert.equal(f.state.editing, false); assert.equal(f.node('home-settings-dialog').open, false);
  f.settings.begin(); await f.click('home-settings-open'); await f.click('home-dialog-cancel'); assert.equal(f.cancellations, 1); f.shell.dispose();
});

test('fullscreen denial and Escape exit preserve drafts, labels follow the browser, and cancellation stays explicit', async () => {
  const f = fixture(); f.state = { settings: {}, editing: true }; f.rejectFullscreen = true;
  await f.click('home-fullscreen'); assert.match(f.node('home-fullscreen-status').textContent, /could not/); assert.equal(f.state.editing, true);
  f.rejectFullscreen = false; await f.click('home-fullscreen'); assert.equal(f.node('home-fullscreen').textContent, 'Exit fullscreen'); f.escape(); assert.equal(f.cancellations, 0);
  await f.document.exitFullscreen(); f.escape(); assert.equal(f.cancellations, 0); assert.equal(f.node('home-fullscreen').textContent, 'Enter fullscreen'); assert.ok(f.gestureCancels >= 3);
  f.time = 2000; f.escape(); assert.equal(f.cancellations, 1); f.shell.dispose();
});

test('unsupported fullscreen remains disabled while Settings still opens', async () => {
  const f = fixture(); f.shell.dispose(); f.document.fullscreenEnabled = false;
  const shell = createHomeShell({ document: f.document, settings: f.settings, prepareSettings() {}, cancelGesture() {} });
  assert.equal(f.node('home-fullscreen').disabled, true); assert.equal(f.node('home-fullscreen').textContent, 'Fullscreen unavailable'); await f.click('home-settings-open'); assert.equal(f.node('home-settings-dialog').open, true); shell.dispose();
});
