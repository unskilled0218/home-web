import { DASHBOARD_WIDGETS, normalizeWidgetLayout, initialWidgetProfile, projectWidget, editWidget, changeWidgetLayer } from './dashboard-layout.js';

export function createDashboardLayoutEditor({ document, window, surface, onChange, position = () => 'left' }) {
  const root = document.getElementById('widget-layout-editor');
  const get = id => document.getElementById(`layout-${id}`);
  const profileControl = get('profile'); const arrangement = get('arrangement'); const selected = get('widget'); const preview = get('preview'); const status = get('status');
  const inputs = Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, get(key)]));
  const events = new AbortController(); const options = { signal: events.signal };
  let draft; let baseline; let saving = false; let gesture; let scale = 1; let disposed = false;
  const boxes = new Map();
  for (const [id, label] of Object.entries(DASHBOARD_WIDGETS)) {
    const option = document.createElement('option'); option.value = id; option.textContent = label; selected.append(option);
    const box = document.createElement('div'); box.className = 'layout-preview-widget'; box.dataset.widget = id;
    for (const [action, text] of [['move', label], ['resize', '↘']]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action; button.textContent = text; button.setAttribute('aria-label', `${action === 'move' ? 'Move' : 'Resize'} ${label}`); box.append(button);
    }
    preview.append(box); boxes.set(id, box);
  }
  const mode = () => profileControl.value;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function announce() {
    const profile = draft?.[mode()];
    if (!profile) { status.textContent = 'Automatic layout. Choose Custom to arrange widgets.'; return; }
    const rect = projectWidget(profile.items.find(item => item.id === selected.value), surface());
    status.textContent = rect ? `${DASHBOARD_WIDGETS[selected.value]} · Layer ${profile.items.findIndex(item => item.id === selected.value) + 1} of 6 (6 is front) · ${rect.w} × ${rect.h} pixels at ${rect.x}, ${rect.y}. Save preferences to share changes.` : 'Window area unavailable. Enlarge the window to edit.';
  }
  function render() {
    if (!draft || disposed) return;
    const area = surface();
    const available = area.width > 0 && area.height > 0;
    const profile = draft[mode()]; const custom = Boolean(profile);
    arrangement.value = custom ? 'custom' : 'automatic';
    scale = available ? Math.min(Math.max(1, root.clientWidth - 32) / area.width, 280 / area.height, 1) : 1;
    preview.style.width = `${available ? area.width * scale : 0}px`; preview.style.height = `${available ? area.height * scale : 0}px`;
    preview.dataset.width = String(area.width); preview.dataset.height = String(area.height); preview.hidden = !custom || !available;
    for (const [id, box] of boxes) {
      const index = profile?.items.findIndex(item => item.id === id) ?? -1;
      const rect = index >= 0 ? projectWidget(profile.items[index], area) : null;
      box.classList.toggle('selected', id === selected.value);
      if (rect) {
        for (const [key, value] of Object.entries({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })) box.style[key] = `${value * scale}px`;
        box.style.zIndex = String(index + 1);
      }
      for (const button of box.querySelectorAll('button')) button.disabled = saving || !available || !custom;
    }
    const rect = custom ? projectWidget(profile.items.find(item => item.id === selected.value), area) : null;
    for (const [key, input] of Object.entries(inputs)) {
      input.disabled = saving || !rect || Boolean(gesture);
      if (rect) input.value = String(rect[key]); else input.value = '';
      input.setCustomValidity('');
      const extent = key === 'x' || key === 'w' ? area.width : area.height;
      input.min = String(key === 'w' || key === 'h' ? Math.min(100, extent) : 0);
      input.max = String(key === 'x' ? Math.max(0, area.width - (rect?.w || 0)) : key === 'y' ? Math.max(0, area.height - (rect?.h || 0)) : extent);
    }
    const index = profile?.items.findIndex(item => item.id === selected.value);
    for (const button of root.querySelectorAll('[data-layer]')) button.disabled = saving || !custom || Boolean(gesture) || (['front', 'forward'].includes(button.dataset.layer) ? index === 5 : index === 0);
    profileControl.disabled = saving; selected.disabled = saving;
    arrangement.disabled = saving || !available;
    get('reset').disabled = saving || Boolean(gesture) || !custom;
    get('cancel').disabled = saving || Boolean(gesture) || equal(draft, baseline);
  }
  function changed() { render(); announce(); onChange(); }
  function cancelGesture() {
    if (!gesture) return false;
    const previous = gesture; gesture = undefined; draft[previous.mode] = previous.profile;
    if (previous.target.hasPointerCapture(previous.pointer)) previous.target.releasePointerCapture(previous.pointer);
    render(); announce(); return true;
  }
  profileControl.addEventListener('change', () => { cancelGesture(); render(); announce(); }, options);
  selected.addEventListener('change', () => { cancelGesture(); render(); announce(); }, options);
  arrangement.addEventListener('change', () => {
    cancelGesture(); draft[mode()] = arrangement.value === 'custom' ? initialWidgetProfile(mode(), position()) : null; changed();
  }, options);
  for (const [key, input] of Object.entries(inputs)) input.addEventListener('change', () => {
    if (!Number.isFinite(input.valueAsNumber)) { input.setCustomValidity('Enter a finite pixel value.'); input.reportValidity(); return; }
    const previous = draft[mode()]; draft[mode()] = editWidget(previous, selected.value, { [key]: input.valueAsNumber }, surface());
    if (previous !== draft[mode()]) changed(); else { render(); announce(); }
  }, options);
  for (const button of root.querySelectorAll('[data-layer]')) button.addEventListener('click', () => { draft[mode()] = changeWidgetLayer(draft[mode()], selected.value, button.dataset.layer); changed(); }, options);
  get('reset').addEventListener('click', () => { draft[mode()] = null; changed(); }, options);
  get('cancel').addEventListener('click', () => { draft = structuredClone(baseline); changed(); }, options);
  preview.addEventListener('pointerdown', event => {
    const target = event.target.closest('button[data-action]');
    if (!target || target.disabled || gesture || event.button !== 0 || event.isPrimary === false) return;
    selected.value = target.parentElement.dataset.widget;
    const profile = draft[mode()]; const area = surface(); const item = profile.items.find(item => item.id === selected.value);
    gesture = { target, pointer: event.pointerId, mode: mode(), profile, area, id: item.id, rect: projectWidget(item, area), x: event.clientX, y: event.clientY, scale, action: target.dataset.action };
    target.setPointerCapture(event.pointerId); target.focus({ preventScroll: true }); event.preventDefault(); render();
  }, options);
  preview.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const g = gesture; const dx = Math.round((event.clientX - g.x) / g.scale); const dy = Math.round((event.clientY - g.y) / g.scale);
    const pixels = g.action === 'move' ? { x: g.rect.x + dx, y: g.rect.y + dy } : { w: g.rect.w + dx, h: g.rect.h + dy };
    draft[g.mode] = editWidget(g.profile, g.id, pixels, g.area); render();
  }, options);
  preview.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const g = gesture; gesture = undefined; g.target.releasePointerCapture(g.pointer);
    if (!equal(draft[g.mode], g.profile)) changed(); else { draft[g.mode] = g.profile; render(); announce(); }
  }, options);
  preview.addEventListener('pointercancel', event => { if (gesture?.pointer === event.pointerId) cancelGesture(); }, options);
  preview.addEventListener('lostpointercapture', event => { if (gesture?.pointer === event.pointerId) cancelGesture(); }, options);
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && cancelGesture()) { event.preventDefault(); event.stopPropagation(); } }, options);
  const observer = new window.ResizeObserver(() => refreshSurface()); observer.observe(root);
  function refreshSurface() {
    if (gesture) { const area = surface(); if (area.width !== gesture.area.width || area.height !== gesture.area.height || area.x !== gesture.area.x || area.y !== gesture.area.y) cancelGesture(); }
    render();
  }
  return {
    setDraft(value) { cancelGesture(); draft = normalizeWidgetLayout(value); baseline = structuredClone(draft); render(); announce(); },
    getDraft() { if (gesture) throw new Error('Finish the layout gesture before saving.'); for (const input of Object.values(inputs)) if (!input.disabled && !input.checkValidity()) throw new Error('Enter valid widget pixel values before saving.'); return normalizeWidgetLayout(draft); },
    setSaving(value) { if (value) cancelGesture(); saving = value; render(); },
    refreshSurface,
    cancelGesture,
    dispose() { cancelGesture(); disposed = true; events.abort(); observer.disconnect(); }
  };
}
