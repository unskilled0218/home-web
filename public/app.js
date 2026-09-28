import { WIDGETS, addWidget, changeWidget, columns, layoutMode, minimumWidth, DESKTOP_ROWS, NO_SPACE } from './home-layout.js';
import { createHomeSettingsController } from './home-settings.js';
import { createWidgetEditor, createWidgetOwners } from './home-widgets.js';
import { createHomeIntegrations } from './home-integrations.js';
import { createHomeInformation } from './home-information.js';
import { searchLocations } from './dashboard-weather.js';
import { createHomeShell } from './home-shell.js';

const $ = (id) => document.getElementById(id);
const roots = { time: $('home-time'), weather: $('home-weather'), calendar: $('home-calendar'), bookmarks: $('bookmarks-section'), 'home-assistant': $('home-assistant-section'), wol: $('wol-section') };
const settingsDialog = $('home-settings-dialog');
let mode = layoutMode(window.innerWidth); let current; let selectionDraft = []; let devices = []; let searchAbort; let searchGeneration = 0; let settingsLauncher;
const make = (tag, text, className) => { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; };
function button(text, action) { const element = make('button', text, 'button secondary'); element.type = 'button'; element.addEventListener('click', action); return element; }
const announce = (message) => { for (const id of ['home-status', 'home-settings-status']) if ($(id).textContent !== message) $(id).textContent = message; };
const integrations = createHomeIntegrations({ onDevices: (next) => { devices = next; if (settingsDialog.open) renderSelections(); } });
const information = createHomeInformation();
const owners = createWidgetOwners({ integrations, information });
const editor = createWidgetEditor({ grid: $('home-grid'), roots, onChange: (items) => change((next) => { next.layouts[mode] = items; return next; }, false), onRemove: (id) => { change((next) => { next.layouts[mode] = next.layouts[mode].filter((item) => item.id !== id); return next; }, false); $('home-settings-open').focus(); }, announce });
const settings = createHomeSettingsController({ onChange: render });
const shell = createHomeShell({ settings, prepareSettings() { fillPreferences(); selectionDraft = structuredClone(current.settings.widgetSettings['home-assistant'].selections); renderSelections(); renderGeometry(); }, cancelGesture: () => editor.cancelGesture() });

function render(state) {
  const previousRevision = current?.settings?.revision;
  current = state;
  $('home-config').disabled = !state.settings || state.saving;
  $('home-settings-open').setAttribute('aria-label', state.editing ? 'Settings, unsaved changes' : 'Settings');
  $('home-edit').textContent = state.editing ? 'Continue editing widgets' : 'Edit widgets';
  for (const id of ['home-toolbar-save', 'home-toolbar-cancel']) $(id).hidden = !state.editing;
  for (const id of ['home-dialog-save', 'home-toolbar-save']) $(id).disabled = !state.editing || state.saving || state.conflict;
  for (const id of ['home-dialog-cancel', 'home-toolbar-cancel']) $(id).disabled = state.saving;
  announce(state.error || (state.conflict ? 'Another device changed shared settings. Cancel / reload, then reapply your edits.' : state.saving ? 'Saving shared settings…' : state.editing ? 'Unsaved changes. Reopen Settings to save or cancel.' : state.settings ? 'Shared settings loaded.' : 'Loading shared settings…'));
  $('home-retry').hidden = Boolean(state.settings) && !state.error;
  $('home-layout-label').textContent = `${mode === 'desktop' ? 'Desktop' : 'Mobile'} layout`;
  if (!state.settings) return;
  $('home-grid').hidden = false;
  const items = state.settings.layouts[mode]; $('home-empty').hidden = items.length > 0;
  editor.render(items, mode, state.editing && !state.saving);
  owners.configure(items, state.settings);
  renderCatalog();
  if (settingsDialog.open && !state.editing && previousRevision !== state.settings.revision) { fillPreferences(); selectionDraft = structuredClone(state.settings.widgetSettings['home-assistant'].selections); renderSelections(); renderGeometry(); }
}
async function change(transform, immediate = true) {
  const wasEditing = current?.editing;
  settings.update(transform);
  if (immediate && !wasEditing) await settings.save();
}
async function updateLayout(operation, immediate = true) {
  if (!current?.settings) return;
  const items = operation(current.settings.layouts[mode]);
  if (!items) { announce(NO_SPACE); return; }
  await change((next) => { next.layouts[mode] = items; return next; }, immediate);
}
function renderCatalog() {
  if (!current?.settings) return;
  $('home-catalog-title').textContent = `Add widgets to ${mode} layout`;
  for (const [id, definition] of Object.entries(WIDGETS)) {
    const exists = current.settings.layouts[mode].some((item) => item.id === id);
    let add = $('home-catalog').querySelector(`[data-add="${id}"]`);
    if (!add) { add = button('', async () => { await updateLayout((items) => addWidget(items, id, mode)); renderGeometry(); }); add.dataset.add = id; $('home-catalog').append(add); }
    add.textContent = `${definition.label}${exists ? ' (added)' : ''}`; add.disabled = exists || current.saving;
  }
}
function renderGeometry() {
  $('home-geometry').replaceChildren();
  for (const item of current.settings.layouts[mode]) {
    const form = document.createElement('form'); form.className = 'geometry-row'; form.append(make('strong', WIDGETS[item.id].label));
    for (const key of ['x', 'y', 'w', 'h']) {
      const label = make('label', { x: 'Column (0-based)', y: 'Row (0-based)', w: 'Width', h: 'Height' }[key]); const input = document.createElement('input'); input.name = key; input.type = 'number'; input.required = true; input.step = 1; input.value = item[key]; input.min = key === 'w' ? minimumWidth(item.id, mode) : key === 'h' ? 3 : 0; input.max = key === 'w' ? columns(mode) : key === 'h' ? (mode === 'desktop' ? DESKTOP_ROWS : 24) : key === 'x' ? columns(mode) - item.w : mode === 'desktop' ? DESKTOP_ROWS - item.h : 144; label.append(input); form.append(label);
    }
    const submit = button('Apply size / position', () => {}); submit.type = 'submit'; form.append(submit, button('Remove', async () => { await change((next) => { next.layouts[mode] = next.layouts[mode].filter((entry) => entry.id !== item.id); return next; }); renderGeometry(); }));
    form.addEventListener('submit', (event) => { event.preventDefault(); updateLayout((items) => changeWidget(items, item.id, Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)])), mode), false); renderGeometry(); });
    $('home-geometry').append(form);
  }
}
function fillPreferences() {
  for (const control of $('home-preferences').elements) if (control.name in current.settings.preferences) {
    if (control.type === 'checkbox') control.checked = current.settings.preferences[control.name]; else control.value = current.settings.preferences[control.name];
  }
  $('home-location-status').textContent = current.settings.preferences.location?.label || 'No location selected.';
}
settingsDialog.addEventListener('close', () => { searchGeneration++; searchAbort?.abort(); });
$('home-preferences').addEventListener('input', () => settings.begin());
$('home-preferences').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try { new Intl.DateTimeFormat('en', { timeZone: form.elements.timezone.value }); }
  catch { $('home-settings-status').textContent = 'Enter a valid IANA timezone, for example Europe/London.'; return; }
  change((next) => { for (const control of form.elements) if (control.name in next.preferences) next.preferences[control.name] = control.type === 'checkbox' ? control.checked : control.value; return next; });
});
$('home-location-search').addEventListener('submit', async (event) => {
  event.preventDefault(); searchAbort?.abort(); searchAbort = new AbortController(); const request = ++searchGeneration;
  $('home-location-status').textContent = 'Searching…'; $('home-location-results').replaceChildren();
  try {
    const results = await searchLocations($('home-location-query').value, { signal: searchAbort.signal });
    if (request !== searchGeneration) return;
    $('home-location-status').textContent = results.length ? 'Select a location.' : 'No matching locations.';
    for (const location of results) { const li = document.createElement('li'); li.append(button(location.label, async () => { await change((next) => { next.preferences.location = location; return next; }); $('home-location-status').textContent = location.label; })); $('home-location-results').append(li); }
  } catch { if (request === searchGeneration) $('home-location-status').textContent = 'Location search unavailable.'; }
});
$('home-location-clear').addEventListener('click', () => { searchGeneration++; searchAbort?.abort(); $('home-location-results').replaceChildren(); change((next) => { next.preferences.location = null; return next; }); $('home-location-status').textContent = 'Location cleared.'; });

function renderSelections() {
  const list = $('home-selections'); list.replaceChildren(); const term = $('home-select-search').value.toLowerCase();
  const all = [...devices, ...selectionDraft.filter((selection) => !devices.some((device) => device.selectionId === selection.id)).map((selection) => ({ selectionId: selection.id, name: 'Selected device unavailable', measurements: [] }))];
  for (const device of all) {
    if (!`${device.name} ${device.area ?? ''}`.toLowerCase().includes(term)) continue;
    const section = document.createElement('fieldset'); const label = make('label', `${device.name}${device.area ? ` · ${device.area}` : ''}`, 'toggle'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    const selected = selectionDraft.find((selection) => selection.id === device.selectionId); checkbox.checked = Boolean(selected);
    checkbox.addEventListener('change', () => { settings.begin(); selectionDraft = selectionDraft.filter((selection) => selection.id !== device.selectionId); if (checkbox.checked) selectionDraft.push({ id: device.selectionId, readings: device.measurements.map((reading) => reading.selectionId) }); renderSelections(); }); label.prepend(checkbox); section.append(label);
    if (selected) {
      const readings = [...device.measurements, ...selected.readings.filter((id) => !device.measurements.some((reading) => reading.selectionId === id)).map((id) => ({ selectionId: id, name: 'Selected reading unavailable' }))];
      for (const reading of readings) { const row = make('label', reading.name, 'toggle'); const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.readings.includes(reading.selectionId); check.addEventListener('change', () => { settings.begin(); selected.readings = selected.readings.filter((id) => id !== reading.selectionId); if (check.checked) selected.readings.push(reading.selectionId); }); row.prepend(check); section.append(row); }
    }
    list.append(section);
  }
  $('home-select-status').textContent = all.length ? 'Choose devices and readings, then Apply.' : 'Load devices after connecting Home Assistant.';
}
$('home-select-search').addEventListener('input', renderSelections);
$('home-select-load').addEventListener('click', async () => { $('home-select-status').textContent = 'Loading devices…'; devices = await integrations.devices(); renderSelections(); });
$('home-select-save').addEventListener('click', () => { try { change((next) => { next.widgetSettings['home-assistant'].selections = structuredClone(selectionDraft); return next; }).catch((error) => { $('home-select-status').textContent = error.message; }); } catch (error) { $('home-select-status').textContent = error.message; } });
for (const control of document.querySelectorAll('[data-integration]')) control.addEventListener('click', async () => { settingsLauncher = $('home-settings-open'); settingsDialog.close(); await integrations.openSettings(control.dataset.integration); });
$('home-calendar-open').addEventListener('click', async () => { settingsLauncher = $('home-settings-open'); settingsDialog.close(); await information.openCalendar(); });
for (const dialog of document.querySelectorAll('dialog:not(#home-settings-dialog)')) {
  dialog.addEventListener('close', () => { (settingsLauncher ?? $('home-settings-open')).focus(); settingsLauncher = null; });
}
const gridObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => editor.cancelGesture()) : null;
gridObserver?.observe($('home-grid'));
window.addEventListener('resize', () => { editor.cancelGesture(); const next = layoutMode(window.innerWidth); if (next === mode) return; mode = next; if (current) render(current); if (settingsDialog.open && current?.settings) renderGeometry(); });
document.addEventListener('visibilitychange', () => { const visible = !document.hidden; information.setVisible(visible); settings.setVisible(visible); });
window.addEventListener('focus', () => { if (!document.hidden) void settings.load(); });
window.addEventListener('pagehide', (event) => { editor.cancelGesture(); searchGeneration++; searchAbort?.abort(); owners.suspend(); settings.setVisible(false); if (!event.persisted) { information.dispose(); settings.dispose(); editor.dispose(); gridObserver?.disconnect(); shell.dispose(); } });
window.addEventListener('pageshow', (event) => { if (event.persisted) { owners.resume(!document.hidden); settings.setVisible(!document.hidden); if (current) render(current); } });
settings.setVisible(!document.hidden);
if (document.hidden) void settings.load();
