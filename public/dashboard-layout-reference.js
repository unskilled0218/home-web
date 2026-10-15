export const REFERENCE_STATUS_PIXELS = 32;
export const LAYOUT_GAP_PIXELS = 8;
export const CAPTION_PIXELS = 48;
export const layoutMargin = mobile => mobile ? 8 : 16;

export function layoutDimensions(value) {
  if (!Number.isFinite(value?.width) || !Number.isFinite(value?.height)) return null;
  const width = Math.floor(value?.width); const height = Math.floor(value?.height);
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}

function safeInsets(value = {}) {
  return Object.fromEntries(['top', 'bottom', 'left', 'right'].map(edge => [edge, Number.isFinite(value[edge]) ? Math.max(0, value[edge]) : 0]));
}

// Browser observations are inputs, not dependencies. Nothing here reads or writes storage.
export function createLayoutReference() {
  let candidate; let accepted; let pending = false; let locked = false; let epoch = 0;
  function accept() {
    if (locked) { pending = true; return; }
    if (!candidate?.raw) { accepted = undefined; return; }
    const { raw, safe, source, context } = candidate;
    accepted = Object.freeze(Object.fromEntries(['desktop', 'mobile'].map(mode => {
      const margin = layoutMargin(mode === 'mobile');
      return [mode, Object.freeze({ x: 0, y: 0, width: Math.max(0, Math.floor(raw.width - margin * 2 - safe.left - safe.right)), height: Math.max(0, Math.floor(raw.height - margin * 2 - safe.top - safe.bottom - REFERENCE_STATUS_PIXELS - LAYOUT_GAP_PIXELS - CAPTION_PIXELS)), source, context })];
    })));
  }
  function refresh(snapshot, { orientationChanged = false } = {}) {
    const screen = layoutDimensions(snapshot.screen);
    const orientation = snapshot.screen?.orientation;
    if (orientationChanged && !orientation) epoch++;
    const context = JSON.stringify([screen, orientation ?? null, epoch]);
    if (candidate?.context === context && candidate.raw) return;
    candidate = { context, raw: screen || layoutDimensions(snapshot.viewport), safe: safeInsets(snapshot.safe), source: screen ? 'estimated' : 'fallback' };
    accept();
  }
  return {
    refresh,
    get: mode => accepted?.[mode] || { x: 0, y: 0, width: 0, height: 0, source: 'unavailable', context: null },
    confirm(snapshot) {
      refresh(snapshot);
      const raw = layoutDimensions(snapshot.viewport);
      if (!raw) return;
      candidate = { ...candidate, raw, safe: safeInsets(snapshot.safe), source: 'confirmed' }; accept();
    },
    lock() { locked = true; },
    release() { locked = false; if (pending) { pending = false; accept(); } }
  };
}
