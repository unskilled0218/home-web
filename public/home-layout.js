import { normalizeSettings } from './dashboard-helpers.js';

export const WIDGETS = Object.freeze({ time: { label: 'Time', width: 4, height: 3 }, weather: { label: 'Weather', width: 8, height: 6 }, calendar: { label: 'Calendar', width: 4, height: 6 }, bookmarks: { label: 'Bookmarks', width: 6, height: 6 }, 'home-assistant': { label: 'Home Assistant', width: 6, height: 6 }, wol: { label: 'Wake-on-LAN', width: 6, height: 6 } });
export const columns = (mode) => mode === 'mobile' ? 4 : 12;
export const minimumWidth = (id, mode) => mode === 'mobile' ? (id === 'time' ? 2 : 4) : (id === 'time' ? 2 : 4);
export const layoutMode = (width) => width < 768 ? 'mobile' : 'desktop';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function arrange(items, mode, priority) {
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

export function addWidget(items, id, mode) {
  if (items.some((item) => item.id === id) || !Object.hasOwn(WIDGETS, id)) return items;
  const item = { id, type: id, x: 0, y: 0, w: mode === 'mobile' ? 4 : WIDGETS[id].width, h: WIDGETS[id].height };
  while (true) {
    for (item.x = 0; item.x <= columns(mode) - item.w; item.x++) if (!items.some((other) => overlaps(item, other))) return arrange([...items, item], mode);
    item.y++;
  }
}

export function changeWidget(items, id, delta, mode) {
  return arrange(items.map((item) => item.id === id ? { ...item, ...delta, id: item.id, type: item.type } : item), mode, id);
}

const preferenceKeys = ['timezone', 'dateStyle', 'hour12', 'seconds', 'location', 'temperature', 'wind', 'precipitation'];
export function displayPreferences(input = {}) {
  const normalized = normalizeSettings(input, 'UTC');
  return Object.fromEntries(preferenceKeys.map((key) => [key, normalized[key]]));
}

export function defaultHomeSettings() {
  const layouts = {};
  for (const mode of ['desktop', 'mobile']) layouts[mode] = Object.keys(WIDGETS).reduce((items, id) => addWidget(items, id, mode), []);
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
