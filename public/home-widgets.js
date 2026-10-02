import { WIDGETS, changeWidget, NO_SPACE, projectLayout } from './home-layout.js';

// Geometry edits must not restart data owners or their refresh timers.
export function createWidgetOwners({ integrations, information }) {
  let signature = ''; let latest; let suspended = false;
  function configure(items, settings) {
    latest = { items, settings };
    const ids = items.map((item) => item.id);
    const next = JSON.stringify([ids.slice().sort(), settings.preferences, settings.widgetSettings]);
    if (suspended || signature === next) return;
    signature = next;
    integrations.configure(ids, settings.widgetSettings['home-assistant'].selections);
    information.configure(ids, settings.preferences);
  }
  return {
    configure,
    suspend() { suspended = true; signature = ''; integrations.suspend(); information.setVisible(false); },
    resume(visible) { suspended = false; if (latest) configure(latest.items, latest.settings); information.setVisible(visible); }
  };
}

export function gestureLayout(layout, id, kind, dx, dy, mode) {
  const item = layout.items.find((entry) => entry.id === id);
  if (!item) return layout;
  return changeWidget(layout, id, kind === 'resize' ? { w: item.w + dx, h: item.h + dy } : { x: item.x + dx, y: item.y + dy }, mode);
}

export function canvasMetrics(grid) {
  const rect = grid.getBoundingClientRect();
  return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
}

export function createWidgetEditor({ grid, roots, onChange, onRemove, announce, document = globalThis.document, measure = canvasMetrics }) {
  let layout = { canvas: { width: 1, height: 1 }, items: [] }; let mode = 'desktop'; let editing = false; let gesture = null;
  let measuredCanvas = null;
  const handles = new Map(); const headings = new Map();
  for (const [id, root] of Object.entries(roots)) {
    root.classList.add('home-widget');
    if (!root.querySelector('.widget-content')) { const body = document.createElement('div'); body.className = 'widget-content'; body.append(...root.childNodes); root.append(body); }
    const header = document.createElement('header'); header.className = 'widget-heading';
    const controls = [];
    for (const kind of ['move', 'remove', 'resize']) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `widget-${kind}`; button.dataset.widget = id; button.dataset.kind = kind;
      button.textContent = kind === 'move' ? 'Move' : kind === 'remove' ? 'Remove' : '●';
      button.setAttribute('aria-label', `${kind === 'resize' ? 'Resize' : kind === 'move' ? 'Move' : 'Remove'} ${WIDGETS[id].label}${kind !== 'remove' ? '; use arrow keys' : ''}`);
      if (kind === 'remove') button.addEventListener('click', () => onRemove(id, mode));
      else {
        button.addEventListener('pointerdown', start);
        button.addEventListener('pointermove', move);
        button.addEventListener('pointerup', finish);
        button.addEventListener('pointercancel', cancel);
        button.addEventListener('lostpointercapture', cancel);
        button.addEventListener('keydown', (event) => {
          const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!editing || !delta) return; event.preventDefault();
          const current = materialize(); const next = gestureLayout(current, id, kind, ...delta, mode);
          if (!next) { announce(NO_SPACE); return; }
          onChange(next, mode); announce(`${WIDGETS[id].label} ${kind === 'resize' ? 'resized' : 'moved'} by one pixel.`);
        });
      }
      controls.push(button);
      if (kind === 'resize') root.append(button); else header.append(button);
    }
    root.prepend(header); handles.set(id, controls); headings.set(id, header);
  }
  function targetCanvas() {
    const measured = measure(grid, mode, layout);
    measuredCanvas = measured;
    return measured;
  }
  function materialize() { return projectLayout(layout, targetCanvas(), mode); }
  function paint(next) {
    const focused = document.activeElement;
    grid.style.height = `${next.canvas.height}px`; measuredCanvas = { ...next.canvas };
    for (const [id, root] of Object.entries(roots)) root.hidden = !next.items.some((item) => item.id === id);
    next.items.forEach((item, index) => {
      const root = roots[item.id]; root.style.left = `${item.x}px`; root.style.top = `${item.y}px`; root.style.width = `${item.w}px`; root.style.height = `${item.h}px`;
      if (!gesture && grid.children[index] !== root) grid.insertBefore(root, grid.children[index] ?? null);
    });
    if (focused && document.activeElement !== focused && !focused.closest('[hidden]')) focused.focus({ preventScroll: true });
  }
  function start(event) {
    if (!editing || event.button !== 0 || gesture) return;
    event.preventDefault(); const button = event.currentTarget; const before = materialize();
    gesture = { button, pointerId: event.pointerId, id: button.dataset.widget, kind: button.dataset.kind, x: event.clientX, y: event.clientY, before, next: before };
    button.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.next = gestureLayout(gesture.before, gesture.id, gesture.kind, Math.round(event.clientX - gesture.x), Math.round(event.clientY - gesture.y), mode);
    paint(gesture.next ?? gesture.before);
  }
  function release() { const previous = gesture; gesture = null; if (previous?.button.hasPointerCapture(previous.pointerId)) previous.button.releasePointerCapture(previous.pointerId); return previous; }
  function finish(event) { if (!gesture || event.pointerId !== gesture.pointerId) return; move(event); const previous = release(); if (!previous.next) { paint(previous.before); announce(NO_SPACE); return; } onChange(previous.next, mode); announce(`${WIDGETS[previous.id].label} position and size updated.`); }
  function cancel() { if (!gesture) return; const previous = release(); paint(previous.before); }
  return {
    render(next, nextMode, isEditing) {
      if (mode !== nextMode || !isEditing) cancel();
      layout = next; mode = nextMode; editing = isEditing;
      for (const controls of handles.values()) for (const button of controls) button.hidden = !editing;
      for (const heading of headings.values()) heading.hidden = !editing;
      grid.classList.toggle('editing', editing); if (!gesture) paint(materialize());
    },
    materialize(next = layout, nextMode = mode) {
      const previousLayout = layout; const previousMode = mode; layout = next; mode = nextMode;
      const result = materialize(); layout = previousLayout; mode = previousMode; return result;
    },
    resize() {
      const next = measure(grid, mode, layout);
      const changed = !measuredCanvas || next.width !== measuredCanvas.width || next.height !== measuredCanvas.height;
      if (!changed) return;
      cancel(); measuredCanvas = next; paint(materialize());
    },
    cancelGesture: cancel,
    dispose: cancel
  };
}
