import { normalizeSettings } from './dashboard-helpers.js';

export const WIDGETS = Object.freeze({ time: { label: 'Time', width: 4, height: 3 }, weather: { label: 'Weather', width: 8, height: 6 }, calendar: { label: 'Calendar', width: 4, height: 6 }, bookmarks: { label: 'Bookmarks', width: 6, height: 6 }, 'home-assistant': { label: 'Home Assistant', width: 6, height: 6 }, wol: { label: 'Wake-on-LAN', width: 6, height: 6 } });
export const DESKTOP_CANVAS = Object.freeze({ width: 1184, height: 704 });
export const MOBILE_CANVAS = Object.freeze({ width: 384, height: 2400 });
export const MAX_CANVAS_SIZE = 32_768;
export const NO_SPACE = 'Not enough space for that placement. Reduce a widget size or remove a widget in Settings.';
export const layoutMode = (width) => width < 768 ? 'mobile' : 'desktop';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const spatial = (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function minimumSize(id) {
  return id === 'time' ? { width: 120, height: 72 } : { width: 180, height: 120 };
}

function boundedInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum && value <= MAX_CANVAS_SIZE;
}

function normalizedCanvas(canvas, mode) {
  if (!object(canvas) || !boundedInteger(canvas.width, 1) || !boundedInteger(canvas.height, 1)) throw new Error('Invalid widget canvas.');
  if (mode === 'desktop' && (canvas.width < 320 || canvas.height < 240)) throw new Error('Invalid desktop widget canvas.');
  if (mode === 'mobile' && canvas.width < 240) throw new Error('Invalid mobile widget canvas.');
  return { width: canvas.width, height: canvas.height };
}

function clampRect(source, canvas, mode) {
  const minimum = minimumSize(source.id);
  const w = clamp(source.w, Math.min(minimum.width, canvas.width), canvas.width);
  const h = clamp(source.h, Math.min(minimum.height, canvas.height), MAX_CANVAS_SIZE);
  return { ...source, x: clamp(source.x, 0, canvas.width - w), y: clamp(source.y, 0, MAX_CANVAS_SIZE - h), w, h };
}

function candidateCoordinates(item, placed, canvas, mode) {
  const xs = new Set([item.x, 0, canvas.width - item.w]);
  const ys = new Set([item.y, 0, canvas.height - item.h]);
  for (const other of placed) {
    xs.add(other.x - item.w); xs.add(other.x + other.w);
    ys.add(other.y - item.h); ys.add(other.y + other.h);
  }
  const candidates = [];
  for (const x of xs) for (const y of ys) {
    const candidate = { ...item, x, y };
    if (x < 0 || y < 0 || x + item.w > canvas.width || y + item.h > MAX_CANVAS_SIZE) continue;
    if (placed.every((other) => !overlaps(candidate, other))) candidates.push(candidate);
  }
  candidates.sort((a, b) => (Math.abs(a.x - item.x) + Math.abs(a.y - item.y)) - (Math.abs(b.x - item.x) + Math.abs(b.y - item.y)) || spatial(a, b));
  return candidates[0];
}

function fittedLayout(items, canvas, mode, priority) {
  const ordered = priority ? [...items.filter((item) => item.id === priority), ...items.filter((item) => item.id !== priority).sort(spatial)] : [...items].sort(spatial);
  const placed = [];
  for (const source of ordered) {
    const item = clampRect(source, canvas, mode);
    const next = placed.every((other) => !overlaps(item, other)) ? item : candidateCoordinates(item, placed, canvas, mode);
    if (!next) return null;
    placed.push(next);
  }
  const height = Math.max(canvas.height, ...placed.map((item) => item.y + item.h), 1);
  return { canvas: { width: canvas.width, height }, items: placed.sort(spatial) };
}

function defaultSize(id, canvas, mode) {
  const definition = WIDGETS[id];
  const width = mode === 'mobile' ? canvas.width : Math.round(canvas.width * definition.width / 12);
  const height = mode === 'mobile' ? definition.height * 80 - 16 : Math.round(canvas.width * DESKTOP_CANVAS.height / DESKTOP_CANVAS.width * definition.height / 12);
  const minimum = minimumSize(id);
  return { width: clamp(width, minimum.width, canvas.width), height: clamp(height, minimum.height, MAX_CANVAS_SIZE) };
}

export function addWidget(layout, id, mode) {
  if (layout.items.some((item) => item.id === id) || !Object.hasOwn(WIDGETS, id)) return layout;
  const size = defaultSize(id, layout.canvas, mode);
  const source = { id, type: id, x: 0, y: 0, w: size.width, h: size.height };
  const item = candidateCoordinates(source, layout.items, layout.canvas, mode);
  if (!item) return null;
  return fittedLayout([...layout.items, item], { ...layout.canvas, height: Math.max(layout.canvas.height, item.y + item.h) }, mode);
}

export function changeWidget(layout, id, delta, mode) {
  const item = layout.items.find((entry) => entry.id === id);
  if (!item) return layout;
  const edited = { ...item, ...delta, id: item.id, type: item.type };
  return fittedLayout(layout.items.map((entry) => entry.id === id ? edited : entry), layout.canvas, mode, id);
}

export function projectLayout(layout, targetCanvas, mode) {
  const width = Math.max(1, Math.round(targetCanvas.width));
  const scaleX = width / layout.canvas.width;
  const scaledHeight = Math.max(1, Math.round(layout.canvas.height * scaleX));
  const height = Math.max(Math.round(targetCanvas.height), scaledHeight);
  const scaleY = scaledHeight > targetCanvas.height ? scaleX : height / layout.canvas.height;
  const items = layout.items.map((item) => {
    const x = Math.round(item.x * scaleX); const y = Math.round(item.y * scaleY);
    const right = Math.round((item.x + item.w) * scaleX); const bottom = Math.round((item.y + item.h) * scaleY);
    return { ...item, x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
  });
  return { canvas: { width, height }, items };
}

// Version 1 used fixed logical tracks and is retained only for read-time migration.
const legacyColumns = (mode) => mode === 'mobile' ? 4 : 12;
const legacyMinimumWidth = (id) => id === 'time' ? 2 : 4;
function legacyDesktopItem(source) {
  const item = { ...source, w: clamp(source.w, legacyMinimumWidth(source.id), 12), h: clamp(source.h, 3, 12) };
  item.x = clamp(source.x, 0, 12 - item.w); item.y = clamp(source.y, 0, 12 - item.h);
  return item;
}
function legacySlot(item, placed) {
  const candidates = [];
  for (let y = 0; y <= 12 - item.h; y++) for (let x = 0; x <= 12 - item.w; x++) candidates.push({ ...item, x, y });
  return candidates.find((candidate) => placed.every((other) => !overlaps(candidate, other)));
}
function legacyFitDesktop(items) {
  const ordered = [...items].sort(spatial).map(legacyDesktopItem); const placed = [];
  for (const item of ordered) {
    const next = placed.every((other) => !overlaps(item, other)) ? item : legacySlot(item, placed);
    if (!next) {
      const compact = [];
      for (const source of [...items].sort(spatial)) {
        const candidate = legacySlot({ ...source, w: legacyMinimumWidth(source.id), h: 3 }, compact);
        if (!candidate) throw new Error('Legacy desktop widget layout cannot be fitted.');
        compact.push(candidate);
      }
      return compact.sort(spatial);
    }
    placed.push(next);
  }
  return placed.sort(spatial);
}
function legacyArrange(items, mode) {
  if (mode === 'desktop') return legacyFitDesktop(items);
  const placed = [];
  for (const source of [...items].sort(spatial)) {
    const item = { ...source, w: clamp(source.w, legacyMinimumWidth(source.id), legacyColumns(mode)), h: clamp(source.h, 3, mode === 'desktop' ? 12 : 24) };
    item.x = clamp(item.x, 0, legacyColumns(mode) - item.w); item.y = clamp(item.y, 0, mode === 'desktop' ? 12 - item.h : 144);
    while (placed.some((other) => overlaps(item, other))) item.y++;
    placed.push(item);
  }
  return placed.sort(spatial);
}

function legacyLayout(items, mode) {
  const canvas = mode === 'desktop' ? DESKTOP_CANVAS : { ...MOBILE_CANVAS };
  const pitchX = 100; const pitchY = mode === 'desktop' ? 60 : 80; const gap = 16;
  const projected = legacyArrange(items, mode).map((item) => ({ ...item, x: item.x * pitchX, y: item.y * pitchY, w: item.w * pitchX - gap, h: item.h * pitchY - gap }));
  if (mode === 'mobile') canvas.height = Math.max(canvas.height, ...projected.map((item) => item.y + item.h), 1);
  return fittedLayout(projected, canvas, mode) ?? { canvas, items: [] };
}

function normalizeItems(items, canvas, mode) {
  const ids = new Set();
  if (!Array.isArray(items) || items.length > 6) throw new Error('Invalid widget list.');
  const normalized = items.map((item) => {
    if (!object(item) || !Object.hasOwn(WIDGETS, item.id) || item.type !== item.id || ids.has(item.id) || !['x', 'y', 'w', 'h'].every((key) => boundedInteger(item[key], key === 'w' || key === 'h' ? 1 : 0))) throw new Error('Invalid widget geometry or identity.');
    ids.add(item.id);
    return Object.fromEntries(['id', 'type', 'x', 'y', 'w', 'h'].map((key) => [key, item[key]]));
  });
  const fitted = fittedLayout(normalized, canvas, mode);
  if (!fitted) throw new Error('Widget layout cannot be fitted.');
  return fitted;
}

function legacyItems(value, mode) {
  const items = value.layouts[mode]; const ids = new Set();
  if (!Array.isArray(items) || items.length > 6) throw new Error('Invalid widget list.');
  return items.map((item) => {
    if (!object(item) || !Object.hasOwn(WIDGETS, item.id) || item.type !== item.id || ids.has(item.id) || !['x', 'y', 'w', 'h'].every((key) => Number.isSafeInteger(item[key]) && Math.abs(item[key]) <= 10_000)) throw new Error('Invalid widget geometry or identity.');
    ids.add(item.id);
    return Object.fromEntries(['id', 'type', 'x', 'y', 'w', 'h'].map((key) => [key, item[key]]));
  });
}

const preferenceKeys = ['timezone', 'dateStyle', 'hour12', 'seconds', 'location', 'temperature', 'wind', 'precipitation'];
export function displayPreferences(input = {}) {
  const normalized = normalizeSettings(input, 'UTC');
  return Object.fromEntries(preferenceKeys.map((key) => [key, normalized[key]]));
}

export function defaultHomeSettings() {
  const desktopItems = [['time', 0, 0, 4, 3], ['weather', 4, 0, 8, 6], ['calendar', 0, 3, 4, 6], ['bookmarks', 4, 6, 4, 6], ['home-assistant', 8, 6, 4, 6], ['wol', 0, 9, 4, 3]].map(([id, x, y, w, h]) => ({ id, type: id, x, y, w, h }));
  const mobileItems = Object.keys(WIDGETS).map((id, index) => ({ id, type: id, x: 0, y: [0, 3, 9, 15, 21, 27][index], w: 4, h: WIDGETS[id].height }));
  return { version: 2, revision: 0, layouts: { desktop: legacyLayout(desktopItems, 'desktop'), mobile: legacyLayout(mobileItems, 'mobile') }, preferences: displayPreferences(), widgetSettings: { 'home-assistant': { selections: [] } } };
}

export function normalizeHomeSettings(value) {
  if (!object(value) || ![1, 2].includes(value.version) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !object(value.layouts) || !object(value.preferences) || !object(value.widgetSettings)) throw new Error('Invalid home settings envelope.');
  const layouts = {};
  for (const mode of ['desktop', 'mobile']) {
    if (value.version === 1) layouts[mode] = legacyLayout(legacyItems(value, mode), mode);
    else {
      const layout = value.layouts[mode];
      if (!object(layout)) throw new Error('Invalid widget layout.');
      const canvas = normalizedCanvas(layout.canvas, mode);
      layouts[mode] = normalizeItems(layout.items, canvas, mode);
    }
  }
  const selections = value.widgetSettings['home-assistant']?.selections;
  if (!Array.isArray(selections) || selections.length > 50) throw new Error('Select at most 50 Home Assistant devices.');
  const seen = new Set(); let count = 0;
  const normalizedSelections = selections.map((selection) => {
    if (!object(selection) || typeof selection.id !== 'string' || !/^d_[A-Za-z0-9_-]{43}$/.test(selection.id) || seen.has(selection.id) || !Array.isArray(selection.readings) || selection.readings.length > 100) throw new Error('Invalid Home Assistant selection.');
    seen.add(selection.id);
    const readings = [...new Set(selection.readings)]; count += readings.length;
    if (count > 500 || readings.some((id) => typeof id !== 'string' || !/^r_[A-Za-z0-9_-]{43}$/.test(id))) throw new Error('Select at most 500 readings.');
    return { id: selection.id, readings };
  });
  return { version: 2, revision: value.revision, layouts, preferences: displayPreferences(value.preferences), widgetSettings: { 'home-assistant': { selections: normalizedSelections } } };
}
