import { DASHBOARD_WIDGETS, WIDGET_ELEMENTS, projectWidget } from './dashboard-layout.js';
import { createLayoutSession } from './dashboard-layout-session.js';

export function createDashboardLayoutEditor({ document, window, view, getState, save, canEnter, activeProfile, toggleFullscreen, activationBlocked = () => false }) {
  const get = id => document.getElementById(`layout-${id}`);
  const toolbar = get('toolbar'); const frames = get('frames'); const status = get('status');
  const profile = get('profile'); const selected = get('widget'); const arrangement = get('arrangement');
  const inputs = Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, get(key)]));
  const nodes = Object.fromEntries(Object.entries(WIDGET_ELEMENTS).map(([id, element]) => [id, document.getElementById(element)]));
  const session = createLayoutSession(); const raw = new Set(); const boxes = new Map(); const inert = new Map();
  const events = new AbortController(); const options = { signal: events.signal };
  let active = false; let pending = false; let disposed = false; let painting = false; let gesture; let generation = 0; let origin; let message = '';
  for (const [id, label] of Object.entries(DASHBOARD_WIDGETS)) {
    const option = document.createElement('option'); option.value = id; option.textContent = label; selected.append(option);
    const box = document.createElement('div'); box.className = 'layout-edit-frame'; box.dataset.widget = id;
    for (const action of ['move', 'resize']) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action;
      button.setAttribute('aria-label', `${action === 'move' ? 'Move' : 'Resize'} ${label}`); button.textContent = action === 'move' ? label : 'Resize'; box.append(button);
    }
    frames.append(box); boxes.set(id, box);
  }
  const currentFrame = () => view.frame(session.mode);
  const unsaved = () => active && (session.changed() || raw.size > 0);
  function announce() {
    if (!active) return;
    const state = getState(); const { reference, fit } = currentFrame();
    const rect = projectWidget(session.effective().items.find(item => item.id === session.selected), reference);
    status.textContent = message || (!fit ? 'Window area unavailable. Enlarge the window; Cancel remains available.' : session.revision === null ? 'Offline preview. Reload shared layout after the server connects before saving.' : state.snapshot.revision !== session.revision ? 'Preferences changed in another browser. Save reports a conflict; Reload shared layout discards edits.' : !session.draft[session.mode] ? 'Automatic profile: temporary template shown. Moving or resizing creates Custom; no-op Save keeps Automatic.' : `${DASHBOARD_WIDGETS[session.selected]}: ${rect.w} × ${rect.h} reference pixels, X ${rect.x}, Y ${rect.y}, layer ${session.effective().items.findIndex(item => item.id === session.selected) + 1} of 6. Actions are blocked until Save or Cancel.`);
    if (session.mode !== activeProfile()) status.textContent += ' Editing inactive profile geometry only.';
  }
  function controls() {
    if (!active) return;
    const state = getState(); const busy = pending || state.pending; const { fit } = currentFrame();
    for (const input of Object.values(inputs)) input.disabled = busy || !fit || Boolean(gesture);
    profile.disabled = busy; selected.disabled = busy; arrangement.disabled = busy || Boolean(gesture);
    const index = session.effective().items.findIndex(item => item.id === session.selected);
    for (const button of toolbar.querySelectorAll('[data-layer]')) button.disabled = busy || Boolean(gesture) || (['front', 'forward'].includes(button.dataset.layer) ? index === 5 : index === 0);
    get('save').disabled = busy || !state.confirmed || session.revision === null || Boolean(gesture);
    get('cancel').disabled = busy; get('reload').disabled = busy || !state.confirmed || Boolean(gesture); get('reset').disabled = busy || Boolean(gesture) || !session.draft[session.mode]; get('fullscreen').disabled = busy || !document.fullscreenEnabled;
  }
  function render(preserveRaw = true) {
    if (!active || disposed) return;
    const { reference, fit } = currentFrame(); const effective = session.effective();
    profile.value = session.mode; selected.value = session.selected; arrangement.value = session.draft[session.mode] ? 'custom' : 'automatic';
    frames.hidden = !fit;
    for (const [index, item] of effective.items.entries()) {
      const box = boxes.get(item.id); const rect = projectWidget(item, reference);
      box.classList.toggle('selected', item.id === session.selected); box.classList.toggle('layout-hidden-widget', nodes[item.id].hidden);
      box.style.zIndex = String(index + 1);
      if (rect && fit) for (const [key, value] of Object.entries({ left: fit.x + rect.x * fit.scale, top: fit.y + (reference.height - rect.y - rect.h) * fit.scale, width: rect.w * fit.scale, height: rect.h * fit.scale })) box.style[key] = `${value}px`;
      const move = box.querySelector('[data-action=move]'); move.textContent = `${DASHBOARD_WIDGETS[item.id]}${nodes[item.id].hidden ? ' (hidden)' : ''}`;
      for (const button of box.querySelectorAll('button')) button.disabled = pending || getState().pending || !fit || rect.w * fit.scale < 24 || rect.h * fit.scale < 24;
      box.querySelector('[data-action=resize]').hidden = item.id !== session.selected;
    }
    const rect = projectWidget(effective.items.find(item => item.id === session.selected), reference);
    for (const [key, input] of Object.entries(inputs)) {
      if (!preserveRaw || !raw.has(key)) { input.value = rect ? String(rect[key]) : ''; input.setCustomValidity(''); }
      const extent = key === 'x' || key === 'w' ? reference.width : reference.height;
      input.min = String(key === 'w' || key === 'h' ? Math.min(100, extent) : 0);
      input.max = String(key === 'x' ? Math.max(0, extent - (rect?.w || 0)) : key === 'y' ? Math.max(0, extent - (rect?.h || 0)) : extent);
    }
    controls();
  }
  function project() {
    if (!active || painting) return;
    painting = true;
    try { view.setOverride({ mode: session.mode, profile: session.effective() }); } finally { painting = false; }
    render();
  }
  function change() { message = ''; project(); announce(); }
  function commit(key) {
    const input = inputs[key]; input.setCustomValidity('');
    if (!Number.isFinite(input.valueAsNumber) || !input.checkValidity()) { input.setCustomValidity('Enter valid reference pixel values.'); input.focus(); input.reportValidity(); return false; }
    session.edit({ [key]: input.valueAsNumber }, view.reference(session.mode)); raw.delete(key); return true;
  }
  function commitRaw() { for (const key of [...raw]) if (!commit(key)) return false; return true; }
  function cancelGesture() {
    if (!gesture) return false;
    const previous = gesture; gesture = undefined; session.restore(previous.saved);
    if (previous.target.hasPointerCapture(previous.pointer)) previous.target.releasePointerCapture(previous.pointer);
    project(); announce(); return true;
  }
  function restoreFocus() {
    let target = origin?.isConnected && origin.getClientRects().length && !origin.closest('[hidden], [inert]') ? origin : document.getElementById('edit-layout');
    const temporary = !target.hasAttribute('tabindex') && !target.matches('button, a[href], input, select, textarea');
    if (temporary) target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); if (temporary) target.removeAttribute('tabindex');
    // Engines can drop focus asynchronously after removing a temporary anchor.
    if (temporary || document.activeElement !== target) document.getElementById('edit-layout').focus({ preventScroll: true });
  }
  function exit({ focus = true } = {}) {
    if (!active || pending) return;
    cancelGesture(); active = false; generation++; raw.clear();
    toolbar.hidden = true; frames.hidden = true; document.body.classList.remove('dashboard-layout-editing');
    for (const [node, previous] of inert) node.inert = previous; inert.clear();
    view.setOverride(null); view.releaseReference();
    document.getElementById('open-settings').disabled = false; document.getElementById('edit-layout').disabled = false;
    if (focus) restoreFocus();
  }
  function enter(id = 'time', target = document.activeElement) {
    if (disposed || !Object.hasOwn(nodes, id)) return false;
    if (active) { if (!pending && commitRaw()) { cancelGesture(); session.selected = id; change(); selected.focus(); } return true; }
    if (!canEnter()) return false;
    origin = target; generation++; message = ''; raw.clear(); view.lockReference();
    session.load(getState(), activeProfile(), id); active = true;
    toolbar.hidden = false; frames.hidden = false; document.body.classList.add('dashboard-layout-editing');
    selected.focus({ preventScroll: true });
    for (const node of Object.values(nodes)) { inert.set(node, node.inert); node.inert = true; }
    document.getElementById('open-settings').disabled = true; document.getElementById('edit-layout').disabled = true;
    change(); selected.focus({ preventScroll: true }); return true;
  }
  async function submit(event) {
    event.preventDefault(); if (!active || pending || gesture || !commitRaw()) return;
    if (!session.changed()) { exit(); return; }
    if (session.revision === null || !getState().confirmed || getState().pending) return;
    const owner = generation; const payload = session.payload(); pending = true; message = 'Saving shared layout…'; controls(); announce();
    try { await save(payload.preferences, payload.revision); if (!disposed && owner === generation) { pending = false; exit(); } }
    catch (error) { if (!disposed && owner === generation) { message = error.message || 'Shared layout could not be saved.'; } }
    finally { pending = false; if (!disposed && active && owner === generation) { render(); announce(); } }
  }
  get('form').addEventListener('submit', submit, options);
  get('cancel').addEventListener('click', () => { if (!pending) exit(); }, options);
  get('reload').addEventListener('click', () => { if (!active || pending || !getState().confirmed) return; cancelGesture(); raw.clear(); session.load(getState(), session.mode); message = 'Shared layout reloaded; both profile drafts discarded.'; project(); announce(); }, options);
  get('reset').addEventListener('click', () => { if (active && !pending) { cancelGesture(); raw.clear(); session.arrange('automatic'); change(); } }, options);
  get('fullscreen').addEventListener('click', () => { if (!pending) void toggleFullscreen(); }, options);
  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener('input', () => { input.setCustomValidity(''); raw.add(key); }, options);
    input.addEventListener('change', () => { if (active && !pending && commit(key)) change(); }, options);
  }
  for (const control of [profile, selected, arrangement]) control.addEventListener('change', () => {
    if (!active || pending) return;
    const value = control.value;
    cancelGesture(); if (!commitRaw()) { render(); return; }
    if (control === profile) session.mode = value;
    else if (control === selected) session.selected = value;
    else session.arrange(value);
    change();
  }, options);
  for (const button of toolbar.querySelectorAll('[data-layer]')) button.addEventListener('click', () => { if (active && !pending && !button.disabled && commitRaw()) { session.layer(button.dataset.layer); change(); } }, options);
  frames.addEventListener('pointerdown', event => {
    const target = event.target.closest('button[data-action]');
    if (!active || pending || !target || target.disabled || gesture || activationBlocked() || event.button !== 0 || event.isPrimary === false || !commitRaw()) return;
    session.selected = target.parentElement.dataset.widget;
    const frame = currentFrame(); if (!frame.fit) return;
    gesture = { target, pointer: event.pointerId, saved: session.draft[session.mode], original: session.effective(), rect: projectWidget(session.effective().items.find(item => item.id === session.selected), frame.reference), frame: JSON.stringify(frame), scale: frame.fit.scale, x: event.clientX, y: event.clientY, action: target.dataset.action };
    target.setPointerCapture(event.pointerId); target.focus({ preventScroll: true }); event.preventDefault(); render();
  }, options);
  frames.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const g = gesture; const dx = Math.round((event.clientX - g.x) / g.scale); const dy = Math.round((event.clientY - g.y) / g.scale);
    session.restore(g.saved); session.edit(g.action === 'move' ? { x: g.rect.x + dx, y: g.rect.y - dy } : { w: g.rect.w + dx, h: g.rect.h - dy }, view.reference(session.mode), g.original); project();
  }, options);
  frames.addEventListener('pointerup', event => { if (gesture?.pointer === event.pointerId) { const g = gesture; gesture = undefined; g.target.releasePointerCapture(g.pointer); change(); } }, options);
  frames.addEventListener('pointercancel', event => { if (gesture?.pointer === event.pointerId) cancelGesture(); }, options);
  frames.addEventListener('lostpointercapture', event => { if (gesture?.pointer === event.pointerId) cancelGesture(); }, options);
  function guard(event) { if (active && Object.values(nodes).some(node => node.contains(event.target))) { event.preventDefault(); event.stopImmediatePropagation(); } }
  for (const name of ['click', 'auxclick', 'dblclick', 'contextmenu', 'keydown', 'submit']) document.addEventListener(name, guard, { ...options, capture: true });
  document.addEventListener('keydown', event => { if (active && event.key === 'Escape' && cancelGesture()) { event.preventDefault(); event.stopPropagation(); } }, options);
  function interrupt() { cancelGesture(); }
  for (const name of ['blur', 'resize', 'orientationchange', 'pagehide']) window.addEventListener(name, interrupt, options);
  document.addEventListener('fullscreenchange', interrupt, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); }, options);
  window.addEventListener('beforeunload', event => { if (unsaved() || pending) { event.preventDefault(); event.returnValue = ''; } }, options);
  return {
    enter, get active() { return active; }, cancelGesture,
    observe() { if (active) { controls(); announce(); } },
    refreshSurface() { if (!active || painting || disposed) return; if (gesture && JSON.stringify(currentFrame()) !== gesture.frame) cancelGesture(); render(); },
    dispose() { if (disposed) return; pending = false; exit({ focus: false }); disposed = true; generation++; events.abort(); frames.replaceChildren(); }
  };
}
