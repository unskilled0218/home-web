import { projectWidget, WIDGET_ELEMENTS } from './dashboard-layout.js';

export function measureLayoutSurface(document, window) {
  const margin = window.innerWidth <= 600 ? 8 : 16;
  const style = window.getComputedStyle(document.documentElement);
  const safe = edge => Number.parseFloat(style.getPropertyValue(`--layout-safe-${edge}`)) || 0;
  const viewport = window.visualViewport;
  const width = Math.max(0, Math.floor((viewport?.width ?? window.innerWidth) - margin * 2 - safe('left') - safe('right')));
  const height = viewport?.height ?? window.innerHeight;
  const top = Math.ceil(Math.max(margin + safe('top'), ...['page-status', 'page-tools'].map(id => {
    const node = id === 'page-tools' ? document.querySelector('.page-tools') : document.getElementById(id);
    return node?.getBoundingClientRect().bottom || 0;
  })) + 8);
  const caption = document.getElementById('photo-caption').textContent ? 48 : 0;
  return { x: margin + safe('left') + (viewport?.offsetLeft || 0), y: top + (viewport?.offsetTop || 0), width, height: Math.max(0, Math.floor(height - top - margin - safe('bottom') - caption)) };
}

export function createDashboardLayoutView({ document, window, onMeasure = () => {} }) {
  const stage = document.getElementById('widget-surface');
  const content = document.getElementById('dashboard-content');
  const caption = document.getElementById('photo-caption');
  const nodes = Object.fromEntries(Object.entries(WIDGET_ELEMENTS).map(([id, element]) => [id, document.getElementById(element)]));
  const anchors = new Map();
  for (const node of [...Object.values(nodes), caption]) { const anchor = document.createComment('Automatic layout position'); node.before(anchor); anchors.set(node, anchor); }
  let state; let custom = false; let automaticMode; let frame; let disposed = false;
  const surface = () => measureLayoutSurface(document, window);
  function render() {
    if (!state || disposed) return;
    const focused = document.activeElement;
    const profile = state.layout[state.mobile ? 'mobile' : 'desktop'];
    if (profile && !custom) { stage.append(...Object.values(nodes)); stage.after(caption); }
    if (!profile && custom) for (const [node, anchor] of anchors) { anchor.after(node); for (const property of ['left', 'top', 'bottom', 'width', 'height', 'z-index']) node.style.removeProperty(property); }
    const changedMode = custom !== Boolean(profile);
    custom = Boolean(profile);
    document.body.classList.toggle('custom-widget-layout', custom);
    if (!custom) {
      stage.hidden = true; content.hidden = !state.display.content;
      if (changedMode || automaticMode !== state.mobile) caption.before(...(state.mobile ? ['time', 'weather', 'calendar'] : ['calendar', 'time', 'weather']).map(id => nodes[id]));
      automaticMode = state.mobile;
    } else {
      const area = surface();
      content.hidden = true; stage.hidden = !state.display.content || area.width <= 0 || area.height <= 0;
      stage.style.left = `${area.x}px`; stage.style.top = `${area.y}px`; stage.style.width = `${area.width}px`; stage.style.height = `${area.height}px`;
      stage.style.setProperty('--scale', state.mobile ? 1 : state.scale);
      for (const [index, item] of profile.items.entries()) {
        const rect = projectWidget(item, area); if (!rect) continue;
        const node = nodes[item.id];
        for (const [key, value] of Object.entries({ left: rect.x, bottom: rect.y, width: rect.w, height: rect.h })) node.style[key] = `${value}px`;
        node.style.zIndex = String(index + 1);
      }
    }
    if (focused && focused !== document.activeElement && focused.isConnected) focused.focus({ preventScroll: true });
    onMeasure();
  }
  function schedule() { if (!disposed && frame === undefined) frame = window.requestAnimationFrame(() => { frame = undefined; render(); }); }
  const observer = new window.ResizeObserver(schedule);
  for (const node of [document.querySelector('.page-tools'), document.getElementById('page-status'), caption]) observer.observe(node);
  window.addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule);
  return {
    surface,
    update(next) { state = next; render(); },
    dispose() { disposed = true; observer.disconnect(); window.cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); }
  };
}
