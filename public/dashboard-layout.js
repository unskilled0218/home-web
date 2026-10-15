export const LAYOUT_UNITS = 1_000_000;
export const MIN_WIDGET_PIXELS = 100;
export const DASHBOARD_WIDGETS = Object.freeze({ time: 'Time', weather: 'Weather', calendar: 'Calendar', bookmarks: 'Bookmarks', 'home-assistant': 'Home Assistant', wol: 'Wake-on-LAN' });
export const WIDGET_ELEMENTS = Object.freeze({ time: 'clock', weather: 'weather', calendar: 'calendar', bookmarks: 'bookmarks', 'home-assistant': 'dashboard-ha', wol: 'dashboard-wol' });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const defaultWidgetLayout = () => ({ version: 2, desktop: null, mobile: null });

export function fitLayoutCanvas(reference, destination) {
  if (![reference?.width, reference?.height, destination?.width, destination?.height].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(destination.x) || !Number.isFinite(destination.y)) return null;
  const scale = Math.min(1, destination.width / reference.width, destination.height / reference.height);
  return { x: destination.x, y: destination.y + destination.height - reference.height * scale, width: reference.width * scale, height: reference.height * scale, scale };
}

export function normalizeWidgetLayout(value) {
  if (value?.version === 1) throw new Error('Widget layout coordinates changed. Reload this page before saving.');
  if (!fields(value, ['version', 'desktop', 'mobile']) || value.version !== 2) throw new Error('Invalid widget layout.');
  const result = { version: 2 };
  for (const mode of ['desktop', 'mobile']) {
    const profile = value[mode];
    if (profile === null) { result[mode] = null; continue; }
    if (!fields(profile, ['items']) || !Array.isArray(profile.items) || profile.items.length !== 6) throw new Error('A widget layout requires all six widgets.');
    const seen = new Set();
    result[mode] = { items: profile.items.map(item => {
      if (!fields(item, ['id', 'x', 'y', 'w', 'h']) || !Object.hasOwn(DASHBOARD_WIDGETS, item.id) || seen.has(item.id)) throw new Error('Invalid or duplicate widget identity.');
      for (const key of ['x', 'y', 'w', 'h']) if (!Number.isSafeInteger(item[key]) || item[key] < (key === 'w' || key === 'h' ? 1 : 0) || item[key] > LAYOUT_UNITS) throw new Error('Invalid widget geometry.');
      if (item.x + item.w > LAYOUT_UNITS || item.y + item.h > LAYOUT_UNITS) throw new Error('Widget geometry exceeds the layout bounds.');
      seen.add(item.id);
      return { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h };
    }) };
  }
  return result;
}

// Version 1 measured Y downward from the top. Decode only; current writes use v2.
export function decodeStoredWidgetLayout(value) {
  if (value?.version !== 1) return normalizeWidgetLayout(value);
  const result = normalizeWidgetLayout({ ...value, version: 2 });
  for (const mode of ['desktop', 'mobile']) if (result[mode]) result[mode].items = result[mode].items.map(item => ({ ...item, y: LAYOUT_UNITS - item.y - item.h }));
  return result;
}

// Pixel X/Y are distances from the usable surface's left/bottom edges.
export function projectWidget(item, surface) {
  const width = Math.floor(surface.width); const height = Math.floor(surface.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = clamp(Math.round(item.w * width / LAYOUT_UNITS), Math.min(MIN_WIDGET_PIXELS, width), width);
  const h = clamp(Math.round(item.h * height / LAYOUT_UNITS), Math.min(MIN_WIDGET_PIXELS, height), height);
  return { id: item.id, x: clamp(Math.round(item.x * width / LAYOUT_UNITS), 0, width - w), y: clamp(Math.round(item.y * height / LAYOUT_UNITS), 0, height - h), w, h };
}

// Patch only explicit edit fields. A minimum-clamped view is not an inverse model.
export function editWidget(profile, id, pixels, surface) {
  if (!object(pixels) || Object.keys(pixels).some(key => !['x', 'y', 'w', 'h'].includes(key)) || Object.values(pixels).some(value => !Number.isFinite(value))) throw new Error('Invalid widget edit.');
  const original = profile.items.find(item => item.id === id);
  if (!original) throw new Error('Unknown widget.');
  const displayed = projectWidget(original, surface);
  if (!displayed) return profile;
  const next = { ...original };
  for (const [position, size, extent] of [['x', 'w', Math.floor(surface.width)], ['y', 'h', Math.floor(surface.height)]]) {
    if (Object.hasOwn(pixels, size)) {
      const value = clamp(Math.round(pixels[size]), Math.min(MIN_WIDGET_PIXELS, extent), extent);
      if (value !== displayed[size]) { next[size] = clamp(Math.round(value * LAYOUT_UNITS / extent), 1, LAYOUT_UNITS); next[position] = Math.min(next[position], LAYOUT_UNITS - next[size]); }
    }
    if (Object.hasOwn(pixels, position)) {
      const projectedSize = projectWidget(next, surface)[size];
      const value = clamp(Math.round(pixels[position]), 0, extent - projectedSize);
      if (value !== displayed[position]) next[position] = clamp(Math.round(value * LAYOUT_UNITS / extent), 0, LAYOUT_UNITS - next[size]);
    }
  }
  if (['x', 'y', 'w', 'h'].every(key => next[key] === original[key])) return profile;
  return { items: profile.items.map(item => item.id === id ? next : item) };
}

export function changeWidgetLayer(profile, id, action) {
  const index = profile.items.findIndex(item => item.id === id);
  if (index < 0 || !['forward', 'backward', 'front', 'back'].includes(action)) throw new Error('Invalid widget layer action.');
  const target = { forward: Math.min(5, index + 1), backward: Math.max(0, index - 1), front: 5, back: 0 }[action];
  if (target === index) return profile;
  const items = [...profile.items]; const [item] = items.splice(index, 1); items.splice(target, 0, item);
  return { items };
}

export function initialWidgetProfile(mode, position = 'left') {
  const ids = ['calendar', 'time', 'weather', 'home-assistant', 'wol', 'bookmarks'];
  const cells = mode === 'mobile' ? [[0, 1], [0, 0], [1, 0], [1, 1], [0, 2], [1, 2]] : [[0, 0], [0, 1], [1, 0], [1, 1], [2, 1], [2, 0]];
  const columns = mode === 'mobile' ? 2 : 3; const rows = mode === 'mobile' ? 3 : 2;
  return { items: ids.map((id, index) => {
    const [column, row] = cells[index]; const x = Math.round(column * LAYOUT_UNITS / columns); const y = Math.round(row * LAYOUT_UNITS / rows);
    const w = Math.floor(LAYOUT_UNITS / columns) - 10000; const h = Math.floor(LAYOUT_UNITS / rows) - 10000;
    return { id, x: position === 'right' && mode === 'desktop' ? LAYOUT_UNITS - x - w : x, y: LAYOUT_UNITS - y - h, w, h };
  }) };
}
