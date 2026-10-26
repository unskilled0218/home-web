import { initialWidgetProfile, LAYOUT_UNITS, MIN_WIDGET_PIXELS } from './dashboard-layout.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Observations can be fractional, subminimum, or outside the bounded Custom canvas.
export function automaticWidgetPixels(rect, { reference, fit }) {
  if (!fit || ![reference.width, reference.height, fit.scale].every(value => Number.isFinite(value) && value > 0) || ![fit.x, fit.y, rect?.left, rect?.top, rect?.width, rect?.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  return { x: (rect.left - fit.x) / fit.scale, y: reference.height - (rect.top + rect.height - fit.y) / fit.scale, w: rect.width / fit.scale, h: rect.height / fit.scale };
}

export function captureAutomaticLayout(rectangles, frame, mode, position) {
  if (!frame.fit || ![frame.reference.width, frame.reference.height, frame.fit.scale].every(value => Number.isFinite(value) && value > 0) || ![frame.fit.x, frame.fit.y].every(Number.isFinite)) return null;
  const pixels = {}; const screen = {}; const { width, height } = frame.reference;
  const profile = initialWidgetProfile(mode, position);
  for (const item of profile.items) {
    const rect = rectangles[item.id]; const value = automaticWidgetPixels(rect, frame); if (!value) continue;
    pixels[item.id] = value; screen[item.id] = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const w = clamp(value.w, Math.min(MIN_WIDGET_PIXELS, width), width); const h = clamp(value.h, Math.min(MIN_WIDGET_PIXELS, height), height);
    item.w = clamp(Math.round(w / width * LAYOUT_UNITS), 1, LAYOUT_UNITS); item.h = clamp(Math.round(h / height * LAYOUT_UNITS), 1, LAYOUT_UNITS);
    item.x = clamp(Math.round(value.x / width * LAYOUT_UNITS), 0, LAYOUT_UNITS - item.w); item.y = clamp(Math.round(value.y / height * LAYOUT_UNITS), 0, LAYOUT_UNITS - item.h);
  }
  return { pixels, screen, profile };
}

export function layoutInputRange(key, rect, reference) {
  const extent = Math.floor(key === 'x' || key === 'w' ? reference.width : reference.height);
  return { min: key === 'w' || key === 'h' ? Math.min(MIN_WIDGET_PIXELS, extent) : 0, max: key === 'x' ? Math.max(0, extent - rect.w) : key === 'y' ? Math.max(0, extent - rect.h) : extent };
}

export function layoutInputIntent(text, baseline) {
  if (!String(text).trim()) return 'invalid';
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return 'invalid';
  return baseline !== undefined && value === baseline ? 'unchanged' : 'changed';
}
