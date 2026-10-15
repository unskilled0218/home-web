import { projectWidget, fitLayoutCanvas, WIDGET_ELEMENTS } from './dashboard-layout.js';
import { createLayoutReference, layoutMargin, LAYOUT_GAP_PIXELS, CAPTION_PIXELS } from './dashboard-layout-reference.js';

function readSafeInsets(document, window) {
  const style = window.getComputedStyle(document.documentElement);
  return Object.fromEntries(['top', 'bottom', 'left', 'right'].map(edge => [edge, Math.max(0, Number.parseFloat(style.getPropertyValue(`--layout-safe-${edge}`)) || 0)]));
}

export function measureLayoutSurface(document, window) {
  const margin = layoutMargin(window.innerWidth <= 600);
  const insets = readSafeInsets(document, window); const safe = edge => insets[edge];
  const viewport = window.visualViewport;
  const width = Math.max(0, Math.floor((viewport?.width ?? window.innerWidth) - margin * 2 - safe('left') - safe('right')));
  const height = viewport?.height ?? window.innerHeight;
  const top = Math.ceil(Math.max(margin + safe('top'), ...['page-status', 'page-tools'].map(id => {
    const node = id === 'page-tools' ? document.querySelector('.page-tools') : document.getElementById(id);
    return node?.getBoundingClientRect().bottom || 0;
  })) + LAYOUT_GAP_PIXELS);
  const caption = document.getElementById('photo-caption').textContent ? CAPTION_PIXELS : 0;
  return { x: margin + safe('left') + (viewport?.offsetLeft || 0), y: top + (viewport?.offsetTop || 0), width, height: Math.max(0, Math.floor(height - top - margin - safe('bottom') - caption)) };
}

export function createDashboardLayoutView({ document, window, onMeasure = () => {} }) {
  const stage = document.getElementById('widget-surface');
  const content = document.getElementById('dashboard-content');
  const caption = document.getElementById('photo-caption');
  const nodes = Object.fromEntries(Object.entries(WIDGET_ELEMENTS).map(([id, element]) => [id, document.getElementById(element)]));
  const anchors = new Map();
  for (const node of [...Object.values(nodes), caption]) { const anchor = document.createComment('Automatic layout position'); node.before(anchor); anchors.set(node, anchor); }
  let state; let override; let custom = false; let automaticMode; let frame; let disposed = false; let confirmation; let observedContext;
  const references = createLayoutReference();
  const destination = () => measureLayoutSurface(document, window);
  function snapshot() {
    const screen = window.screen;
    const orientation = screen?.orientation;
    const orientationKey = typeof orientation?.type === 'string' && Number.isFinite(orientation.angle) ? `${orientation.type}:${orientation.angle}` : null;
    return { screen: { width: screen?.width, height: screen?.height, orientation: orientationKey }, viewport: { width: window.innerWidth, height: window.innerHeight }, safe: readSafeInsets(document, window) };
  }
  function refreshContext(orientationChanged = false) {
    const value = snapshot(); const context = JSON.stringify(value.screen);
    references.refresh(value, { orientationChanged });
    if ((context !== observedContext || orientationChanged) && document.fullscreenElement) beginConfirmation();
    observedContext = context;
  }
  // A bounded entry-only window accepts late resize observations, never keyboard/zoom reads.
  function beginConfirmation() { confirmation = { remaining: 12, last: null }; }
  function sampleFullscreen() {
    if (!confirmation || !document.fullscreenElement) return;
    const value = snapshot(); const key = JSON.stringify([value.viewport, value.safe]);
    const viewport = window.visualViewport;
    const keyboardOpen = document.activeElement?.matches?.('input, textarea, [contenteditable=true]') && viewport?.height < window.innerHeight - 1;
    const pinched = Number.isFinite(viewport?.scale) && viewport.scale !== 1;
    const settled = key === confirmation.last;
    confirmation.last = key;
    if (--confirmation.remaining <= 0) {
      confirmation = undefined;
      if (settled && !keyboardOpen && !pinched) references.confirm(value);
    }
  }
  refreshContext();
  function render() {
    if (!state || disposed) return;
    const focused = document.activeElement;
    const mode = override?.mode || (state.mobile ? 'mobile' : 'desktop');
    const profile = override?.profile || state.layout[mode];
    if (profile && !custom) { stage.append(...Object.values(nodes)); stage.after(caption); }
    if (!profile && custom) for (const [node, anchor] of anchors) { anchor.after(node); for (const property of ['left', 'top', 'bottom', 'width', 'height', 'z-index', '--widget-width', '--widget-height']) node.style.removeProperty(property); }
    const changedMode = custom !== Boolean(profile);
    custom = Boolean(profile);
    document.body.classList.toggle('custom-widget-layout', custom);
    if (!custom) {
      for (const property of ['left', 'top', 'width', 'height', 'transform', 'transform-origin']) stage.style.removeProperty(property);
      stage.hidden = true; content.hidden = !state.display.content;
      if (changedMode || automaticMode !== state.mobile) caption.before(...(state.mobile ? ['time', 'weather', 'calendar'] : ['calendar', 'time', 'weather']).map(id => nodes[id]));
      automaticMode = state.mobile;
    } else {
      const area = destination(); const reference = references.get(mode);
      const fit = fitLayoutCanvas(reference, area);
      content.hidden = true; stage.hidden = !state.display.content || !fit;
      stage.style.left = `${area.x}px`; stage.style.top = `${area.y + area.height - reference.height}px`; stage.style.width = `${reference.width}px`; stage.style.height = `${reference.height}px`;
      stage.style.transformOrigin = 'left bottom'; stage.style.transform = `scale(${fit?.scale || 0})`;
      stage.dataset.referenceSource = reference.source;
      stage.style.setProperty('--scale', state.mobile ? 1 : state.scale);
      for (const [index, item] of profile.items.entries()) {
        const rect = projectWidget(item, reference); if (!rect) continue;
        const node = nodes[item.id];
        for (const [key, value] of Object.entries({ left: rect.x, bottom: rect.y, width: rect.w, height: rect.h })) node.style[key] = `${value}px`;
        node.style.setProperty('--widget-width', `${rect.w}px`); node.style.setProperty('--widget-height', `${rect.h}px`);
        node.style.zIndex = String(index + 1);
      }
    }
    if (focused && focused !== document.activeElement && focused.isConnected) focused.focus({ preventScroll: true });
    onMeasure();
  }
  function schedule() {
    if (!disposed && frame === undefined) frame = window.requestAnimationFrame(() => {
      frame = undefined; if (disposed) return;
      refreshContext(); sampleFullscreen(); render(); if (confirmation) schedule();
    });
  }
  function fullscreenChanged() { confirmation = undefined; if (document.fullscreenElement) beginConfirmation(); schedule(); }
  function orientationChanged() { refreshContext(true); schedule(); }
  function resumed(event) { if (event.persisted) { refreshContext(); if (document.fullscreenElement) beginConfirmation(); schedule(); } }
  const observer = new window.ResizeObserver(schedule);
  for (const node of [document.querySelector('.page-tools'), document.getElementById('page-status'), caption]) if (node) observer.observe(node);
  window.addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
  document.addEventListener('fullscreenchange', fullscreenChanged); window.screen?.orientation?.addEventListener?.('change', orientationChanged); window.addEventListener('orientationchange', orientationChanged); window.addEventListener('pageshow', resumed);
  if (confirmation) schedule();
  return {
    destination,
    reference: mode => references.get(mode),
    frame(mode) { const reference = references.get(mode); return { reference, fit: fitLayoutCanvas(reference, destination()) }; },
    setOverride(value) { override = value; render(); },
    lockReference() { refreshContext(); references.lock(); },
    releaseReference() { references.release(); render(); },
    update(next) { state = next; refreshContext(); render(); },
    dispose() { disposed = true; confirmation = undefined; observer.disconnect(); window.cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); document.removeEventListener('fullscreenchange', fullscreenChanged); window.screen?.orientation?.removeEventListener?.('change', orientationChanged); window.removeEventListener('orientationchange', orientationChanged); window.removeEventListener('pageshow', resumed); }
  };
}
