import { normalizeSettings } from './dashboard-helpers.js';

export const WIDGETS = Object.freeze({ time: { label: 'Time', width: 4, height: 3 }, weather: { label: 'Weather', width: 8, height: 6 }, calendar: { label: 'Calendar', width: 4, height: 6 }, bookmarks: { label: 'Bookmarks', width: 6, height: 6 }, 'home-assistant': { label: 'Home Assistant', width: 6, height: 6 }, wol: { label: 'Wake-on-LAN', width: 6, height: 6 } });
export const columns = (mode) => mode === 'mobile' ? 4 : 12;
export const DESKTOP_ROWS = 12;
export const NO_SPACE = 'Not enough desktop space for that placement. Reduce a widget size or remove a widget in Settings.';
export const minimumWidth = (id, mode) => mode === 'mobile' ? (id === 'time' ? 2 : 4) : (id === 'time' ? 2 : 4);
export const layoutMode = (width) => width < 768 ? 'mobile' : 'desktop';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function arrange(items, mode, priority) {
  if (mode === 'desktop') return fitDesktop(items);
  const ordered = priority ? [...items.filter((item) => item.id === priority), ...items.filter((item) => item.id !== priority)] : items;
  const placed = [];
  for (const source of ordered) {
    const item = { ...source, w: clamp(source.w, minimumWidth(source.id, mode), columns(mode)), h: clamp(source.h, 3, 24) };
    item.x = clamp(item.x, 0, columns(mode) - item.w); item.y = clamp(item.y, 0, 144);
    while (placed.some((other) => overlaps(item, other))) item.y++;
    if (item.y > 144) { item.y = 0; while (placed.some((other) => overlaps(item, other))) item.y++; }
    placed.push(item);
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}

const spatial = (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
function desktopItem(source) {
  const item = { ...source, w: clamp(source.w, minimumWidth(source.id, 'desktop'), 12), h: clamp(source.h, 3, DESKTOP_ROWS) };
  item.x = clamp(source.x, 0, 12 - item.w); item.y = clamp(source.y, 0, DESKTOP_ROWS - item.h);
  return item;
}
function slot(item, placed, nearest = false) {
  const candidates = [];
  for (let y = 0; y <= DESKTOP_ROWS - item.h; y++) for (let x = 0; x <= 12 - item.w; x++) candidates.push({ ...item, x, y });
  if (nearest) candidates.sort((a, b) => (Math.abs(a.x - item.x) + Math.abs(a.y - item.y)) - (Math.abs(b.x - item.x) + Math.abs(b.y - item.y)) || spatial(a, b));
  return candidates.find((candidate) => placed.every((other) => !overlaps(candidate, other)));
}
// Read-time compatibility: retain valid layouts, then fit old unbounded desktop geometry.
export function fitDesktop(items) {
  const ordered = [...items].sort(spatial).map(desktopItem); const placed = [];
  for (const item of ordered) {
    const next = placed.every((other) => !overlaps(item, other)) ? item : slot(item, placed);
    if (!next) {
      const compact = [];
      for (const source of [...items].sort(spatial)) compact.push(slot({ ...source, w: minimumWidth(source.id, 'desktop'), h: 3 }, compact));
      return compact.sort(spatial);
    }
    placed.push(next);
  }
  return placed.sort(spatial);
}
function placeDesktop(items, edited) {
  const target = desktopItem(edited); const placed = [target]; const blockers = [];
  for (const item of items) {
    if (item.id === target.id) continue;
    if (overlaps(item, target)) blockers.push(item); else placed.push(item);
  }
  for (const item of blockers.sort(spatial)) {
    const next = slot(item, placed, true);
    if (!next) return null;
    placed.push(next);
  }
  return placed.sort(spatial);
}

export function addWidget(items, id, mode) {
  if (items.some((item) => item.id === id) || !Object.hasOwn(WIDGETS, id)) return items;
  const item = { id, type: id, x: 0, y: 0, w: mode === 'mobile' ? 4 : WIDGETS[id].width, h: WIDGETS[id].height };
  if (mode === 'desktop') {
    item.w = id === 'weather' ? 8 : 4; item.h = id === 'time' || id === 'wol' ? 3 : 6;
    const next = slot(item, items);
    return next ? [...items, next].sort(spatial) : null;
  }
  while (true) {
    for (item.x = 0; item.x <= columns(mode) - item.w; item.x++) if (!items.some((other) => overlaps(item, other))) return arrange([...items, item], mode);
    item.y++;
  }
}

export function changeWidget(items, id, delta, mode) {
  if (mode === 'desktop') {
    const item = items.find((entry) => entry.id === id);
    return item ? placeDesktop(items, { ...item, ...delta, id: item.id, type: item.type }) : items;
  }
  return arrange(items.map((item) => item.id === id ? { ...item, ...delta, id: item.id, type: item.type } : item), mode, id);
}

const preferenceKeys = ['timezone', 'dateStyle', 'hour12', 'seconds', 'location', 'temperature', 'wind', 'precipitation'];
export function displayPreferences(input = {}) {
  const normalized = normalizeSettings(input, 'UTC');
  return Object.fromEntries(preferenceKeys.map((key) => [key, normalized[key]]));
}

export function defaultHomeSettings() {
  const layouts = {};
  layouts.desktop = [['time', 0, 0, 4, 3], ['weather', 4, 0, 8, 6], ['calendar', 0, 3, 4, 6], ['bookmarks', 4, 6, 4, 6], ['home-assistant', 8, 6, 4, 6], ['wol', 0, 9, 4, 3]].map(([id, x, y, w, h]) => ({ id, type: id, x, y, w, h }));
  layouts.mobile = Object.keys(WIDGETS).reduce((items, id) => addWidget(items, id, 'mobile'), []);
  return { version: 1, revision: 0, layouts, preferences: displayPreferences(), widgetSettings: { 'home-assistant': { selections: [] } } };
}

export function normalizeHomeSettings(value) {
  if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !object(value.layouts) || !object(value.preferences) || !object(value.widgetSettings)) throw new Error('Invalid home settings envelope.');
  const layouts = {};
  for (const mode of ['desktop', 'mobile']) {
    const items = value.layouts[mode]; const ids = new Set();
    if (!Array.isArray(items) || items.length > 6) throw new Error('Invalid widget list.');
    layouts[mode] = arrange(items.map((item) => {
      if (!object(item) || !Object.hasOwn(WIDGETS, item.id) || item.type !== item.id || ids.has(item.id) || !['x', 'y', 'w', 'h'].every((key) => Number.isSafeInteger(item[key]) && Math.abs(item[key]) <= 10000)) throw new Error('Invalid widget geometry or identity.');
      ids.add(item.id);
      return Object.fromEntries(['id', 'type', 'x', 'y', 'w', 'h'].map((key) => [key, item[key]]));
    }), mode);
  }
  const selections = value.widgetSettings['home-assistant']?.selections;
  if (!Array.isArray(selections) || selections.length > 50) throw new Error('Select at most 50 Home Assistant devices.');
  const seen = new Set(); let count = 0;
  const normalized = selections.map((selection) => {
    if (!object(selection) || typeof selection.id !== 'string' || !/^d_[A-Za-z0-9_-]{43}$/.test(selection.id) || seen.has(selection.id) || !Array.isArray(selection.readings) || selection.readings.length > 100) throw new Error('Invalid Home Assistant selection.');
    seen.add(selection.id);
    const readings = [...new Set(selection.readings)]; count += readings.length;
    if (count > 500 || readings.some((id) => typeof id !== 'string' || !/^r_[A-Za-z0-9_-]{43}$/.test(id))) throw new Error('Select at most 500 readings.');
    return { id: selection.id, readings };
  });
  return { version: 1, revision: value.revision, layouts, preferences: displayPreferences(value.preferences), widgetSettings: { 'home-assistant': { selections: normalized } } };
}
