import { DASHBOARD_WIDGETS, WIDGET_ELEMENTS, projectWidget } from './dashboard-layout.js';
import { createLayoutSession } from './dashboard-layout-session.js';
import { layoutInputRange, layoutInputIntent } from './dashboard-layout-automatic.js';
import { visibleLayoutWidgets } from './dashboard-layout-visibility.js';

export function createDashboardLayoutEditor({ document, window, view, getState, save, canEnter, activeProfile, toggleFullscreen, activationBlocked = () => false }) {
  const get = id => document.getElementById(`layout-${id}`);
  const toolbar = get('toolbar'); const frames = get('frames'); const status = get('status');
  const panel = get('details'); const toggle = get('toggle'); const close = get('close');
  const profile = get('profile'); const selected = get('widget'); const arrangement = get('arrangement');
  const inputs = Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, get(key)]));
  const nodes = Object.fromEntries(Object.entries(WIDGET_ELEMENTS).map(([id, element]) => [id, document.getElementById(element)]));
  const session = createLayoutSession(); const raw = new Set(); const boxes = new Map(); const inert = new Map();
  const widgetOptions = new Map(); const layerRows = new Map(); let eligible = []; let eligibilityKey;
  const displayed = new Map(); const owned = new Map(); let automatic; let livePreview = false;
  const events = new AbortController(); const options = { signal: events.signal };
  let active = false; let pending = false; let disposed = false; let painting = false; let gesture; let generation = 0; let panelEpoch = 0; let origin; let message = '';
  function layerPair(parent, id) {
    for (const [action, label] of [['forward', 'Up'], ['backward', 'Down']]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.layer = action; button.dataset.layerWidget = id;
      button.textContent = label; button.setAttribute('aria-label', `Move ${DASHBOARD_WIDGETS[id]} ${label.toLowerCase()} one layer`); parent.append(button);
    }
  }
  for (const [id, label] of Object.entries(DASHBOARD_WIDGETS)) {
    const option = document.createElement('option'); option.value = id; option.textContent = label; widgetOptions.set(id, option);
    const box = document.createElement('div'); box.className = 'layout-edit-frame'; box.dataset.widget = id;
    for (const action of ['move', 'resize']) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action;
      button.setAttribute('aria-label', `${action === 'move' ? 'Move' : 'Resize'} ${label}`); button.textContent = action === 'move' ? label : 'Resize'; box.append(button);
    }
    const pair = document.createElement('div'); pair.className = 'layout-frame-layers'; layerPair(pair, id); box.append(pair);
    const row = document.createElement('div'); row.dataset.layerRow = id; row.append(document.createElement('span')); layerPair(row, id); layerRows.set(id, row);
    frames.append(box); boxes.set(id, box);
  }
  const currentFrame = () => view.frame(session.mode);
  const liveAutomatic = () => active && !session.draft[session.mode] && session.mode === activeProfile() && Boolean(view.captureAutomatic);
  function measureAutomatic() {
    if (gesture) return;
    automatic = liveAutomatic() ? view.captureAutomatic(session.mode) : undefined;
    if (liveAutomatic()) session.preview(session.mode, automatic?.profile);
  }
  const widgetRect = (id, reference) => { const item = session.effective().items.find(item => item.id === id); return item ? projectWidget(item, reference) : null; };
  const widgetPixels = (id, reference) => (liveAutomatic() && automatic?.pixels[id]) || widgetRect(id, reference);
  const observationBaseline = key => !session.draft[session.mode] ? owned.get(key) ?? (liveAutomatic() ? displayed.get(key) : undefined) : undefined;
  const clearFields = () => { raw.clear(); owned.clear(); displayed.clear(); };
  const unsaved = () => active && (session.changed() || raw.size > 0);
  function eligibleWidgets() {
    const visible = new Set(visibleLayoutWidgets(getState().snapshot.preferences, session.mode, Boolean(document.fullscreenElement)));
    return session.effective().items.filter(item => visible.has(item.id)).map(item => item.id);
  }
  const canEditWidget = id => active && eligibleWidgets().includes(id);
  function reconcileEligibility() {
    const next = eligibleWidgets(); const focused = document.activeElement;
    const losingFocus = [...boxes, ...layerRows].some(([id, node]) => !next.includes(id) && node.contains(focused));
    const movingFocus = [...layerRows.values()].some(node => node.contains(focused));
    const lostSelection = !next.includes(session.selected);
    let gestureRestored = false;
    if (lostSelection) {
      gestureRestored = restoreGesture(); clearFields(); panelEpoch++;
      session.selected = next[0] ?? null;
    }
    eligible = next;
    const key = JSON.stringify(next);
    if (key !== eligibilityKey) {
      selected.replaceChildren(...next.map(id => widgetOptions.get(id)));
      get('layers').replaceChildren(...next.map(id => layerRows.get(id)));
      eligibilityKey = key;
      if (movingFocus && !losingFocus) focused.focus({ preventScroll: true });
    }
    if (losingFocus || lostSelection && Object.values(inputs).includes(focused)) (panel.hidden || !next.length ? toggle : selected).focus({ preventScroll: true });
    return lostSelection && Boolean(gestureRestored);
  }
  function setPanel(open, { focus = true } = {}) {
    if (!active || pending || getState().pending || panel.hidden === !open) return;
    const focusedInside = panel.contains(document.activeElement); panelEpoch++;
    panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    if (focus && !gesture) { if (open) panel.focus({ preventScroll: true }); else if (focusedInside) toggle.focus({ preventScroll: true }); }
  }
  function placeChrome() {
    const viewport = window.visualViewport;
    const values = { top: viewport?.offsetTop || 0, right: Math.max(0, window.innerWidth - (viewport?.offsetLeft || 0) - (viewport?.width ?? window.innerWidth)), width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
    for (const [key, value] of Object.entries(values)) toolbar.style.setProperty(`--layout-chrome-${key}`, `${value}px`);
  }
  function announce() {
    if (!active) return;
    const state = getState(); const { reference, fit } = currentFrame();
    const rect = widgetRect(session.selected, reference);
    let text = message || (!session.selected ? 'No widgets are enabled for this profile. Leave Edit layout to change visibility in Settings.' : !fit ? 'Window area unavailable. Enlarge the window; Cancel remains available.' : session.revision === null ? 'Offline preview. Reload layout after the server connects before saving.' : (state.saveToken ?? state.snapshot.revision) !== session.revision ? 'Preferences or settings scope changed. Reload layout before saving this draft.' : !session.draft[session.mode] ? liveAutomatic() ? 'Automatic profile: live default layout. Numbers are rounded reference-pixel observations; unchanged values keep Automatic. Real edits create bounded Custom geometry.' : 'Automatic inactive profile: temporary template shown. Real edits create Custom; no-op Save keeps Automatic.' : !rect ? 'Window area unavailable. Enlarge the window; Cancel remains available.' : `${DASHBOARD_WIDGETS[session.selected]}: ${rect.w} × ${rect.h} reference pixels, X ${rect.x}, Y ${rect.y}, visible layer ${eligible.indexOf(session.selected) + 1} of ${eligible.length}. Actions are blocked until Save or Cancel.`);
    if (session.mode !== activeProfile()) text += ' Editing inactive profile geometry only.';
    if (status.textContent !== text) status.textContent = text;
  }
  function controls() {
    if (!active) return;
    const state = getState(); const busy = pending || state.pending; const { fit } = currentFrame();
    for (const input of Object.values(inputs)) input.disabled = busy || !session.selected || !fit || liveAutomatic() && !automatic || Boolean(gesture);
    profile.disabled = busy; selected.disabled = busy || !eligible.length; arrangement.disabled = busy || Boolean(gesture);
    const index = eligible.indexOf(session.selected);
    for (const root of [toolbar, frames]) for (const button of root.querySelectorAll('[data-layer]')) {
      const targetIndex = button.dataset.layerWidget ? eligible.indexOf(button.dataset.layerWidget) : index;
      button.disabled = busy || targetIndex < 0 || Boolean(gesture) || (['front', 'forward'].includes(button.dataset.layer) ? targetIndex === eligible.length - 1 : targetIndex === 0);
    }
    toggle.disabled = busy; close.disabled = busy;
    get('save').disabled = busy || !state.confirmed || session.revision === null || Boolean(gesture) || state.source !== session.source;
    get('cancel').disabled = busy; get('reload').disabled = busy || !state.confirmed || Boolean(gesture); get('reset').disabled = busy || Boolean(gesture) || !session.draft[session.mode]; get('fullscreen').disabled = busy || !document.fullscreenEnabled;
  }
  function render(preserveRaw = true) {
    if (!active || disposed) return;
    if (reconcileEligibility()) { project(); return; }
    placeChrome();
    const { reference, fit } = currentFrame(); const effective = session.effective();
    profile.value = session.mode; selected.value = session.selected ?? ''; arrangement.value = session.draft[session.mode] ? 'custom' : 'automatic';
    frames.hidden = !fit;
    for (const [index, item] of effective.items.entries()) {
      const box = boxes.get(item.id); const rect = projectWidget(item, reference);
      const enabled = eligible.includes(item.id);
      const screen = liveAutomatic() && automatic?.screen[item.id]; box.hidden = !enabled || liveAutomatic() && !screen;
      box.classList.toggle('selected', item.id === session.selected);
      box.style.zIndex = String(index + 1);
      if (rect && fit) for (const [key, value] of Object.entries(screen || { left: fit.x + rect.x * fit.scale, top: fit.y + (reference.height - rect.y - rect.h) * fit.scale, width: rect.w * fit.scale, height: rect.h * fit.scale })) box.style[key] = `${value}px`;
      const move = box.querySelector('[data-action=move]'); move.textContent = DASHBOARD_WIDGETS[item.id];
      const screenWidth = screen ? screen.width : rect?.w * fit?.scale; const screenHeight = screen ? screen.height : rect?.h * fit?.scale;
      for (const button of box.querySelectorAll('[data-action]')) button.disabled = !enabled || pending || getState().pending || !fit || screenWidth < 24 || screenHeight < 24;
      box.querySelector('[data-action=resize]').hidden = item.id !== session.selected;
      box.querySelector('.layout-frame-layers').hidden = !fit || screenWidth < 150 || screenHeight < 80;
      layerRows.get(item.id).querySelector('span').textContent = `${DASHBOARD_WIDGETS[item.id]} — visible layer ${eligible.indexOf(item.id) + 1} of ${eligible.length}`;
    }
    const rect = widgetRect(session.selected, reference);
    const observed = widgetPixels(session.selected, reference);
    for (const [key, input] of Object.entries(inputs)) {
      if (!preserveRaw || !raw.has(key) && !owned.has(key)) { input.value = observed ? String(Math.round(observed[key])) : ''; displayed.set(key, input.valueAsNumber); input.setCustomValidity(''); }
      const range = layoutInputRange(key, rect || { w: 0, h: 0 }, reference); const baseline = observationBaseline(key);
      input.min = String(Number.isFinite(baseline) ? Math.min(range.min, baseline) : range.min);
      input.max = String(Number.isFinite(baseline) ? Math.max(range.max, baseline) : range.max);
    }
    controls();
  }
  function project() {
    if (!active || painting) return;
    reconcileEligibility();
    painting = true;
    try { livePreview = liveAutomatic(); if (!livePreview && !session.draft[session.mode]) session.preview(session.mode, null); view.setOverride({ mode: session.mode, profile: livePreview ? null : session.effective() }); measureAutomatic(); } finally { painting = false; }
    render();
  }
  function change() { message = ''; project(); announce(); }
  function intent(key) { return layoutInputIntent(inputs[key].value, observationBaseline(key)); }
  function validateInput(key, report) {
    if (!canEditWidget(session.selected)) return false;
    const input = inputs[key]; input.setCustomValidity(''); const kind = intent(key);
    if (kind === 'unchanged') return true;
    const reference = view.reference(session.mode); const rect = projectWidget(session.effective().items.find(item => item.id === session.selected), reference);
    const range = layoutInputRange(key, rect || { w: 0, h: 0 }, reference); const value = input.valueAsNumber;
    if (kind !== 'invalid' && value >= range.min && value <= range.max && (liveAutomatic() || input.checkValidity())) return true;
    input.setCustomValidity(`Custom ${key} requires whole reference pixels from ${range.min} to ${range.max}. Unchanged Automatic observations can be kept.`);
    if (report) { setPanel(true, { focus: false }); input.focus(); input.reportValidity(); } return false;
  }
  function commit(key, report = true) {
    if (!validateInput(key, report)) return false;
    const unchanged = intent(key) === 'unchanged';
    if (!unchanged) { if (liveAutomatic()) session.arrange('custom'); session.edit({ [key]: inputs[key].valueAsNumber }, view.reference(session.mode)); }
    raw.delete(key); owned.delete(key); return true;
  }
  function commitRaw() {
    reconcileEligibility();
    const keys = [...raw].sort((a, b) => Number(intent(b) === 'unchanged') - Number(intent(a) === 'unchanged'));
    for (const key of keys) if (!validateInput(key, true)) return false;
    for (const key of keys) if (!commit(key)) return false; return true;
  }
  function restoreGesture() {
    if (!gesture) return false;
    const previous = gesture; gesture = undefined; session.restore(previous.saved);
    if (previous.target.hasPointerCapture(previous.pointer)) previous.target.releasePointerCapture(previous.pointer);
    return true;
  }
  function cancelGesture() {
    if (!restoreGesture()) return false;
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
    cancelGesture(); active = false; generation++; clearFields(); automatic = undefined;
    toolbar.hidden = true; frames.hidden = true; panel.hidden = true; panelEpoch++; toggle.setAttribute('aria-expanded', 'false'); document.body.classList.remove('dashboard-layout-editing');
    for (const [node, previous] of inert) node.inert = previous; inert.clear();
    view.setOverride(null); view.releaseReference();
    document.getElementById('open-settings').disabled = false; document.getElementById('edit-layout').disabled = false;
    if (focus) restoreFocus();
  }
  function enter(id = 'time', target = document.activeElement) {
    if (disposed || !Object.hasOwn(nodes, id)) return false;
    if (active) { if (!canEditWidget(id)) return false; if (!pending && commitRaw()) { cancelGesture(); panelEpoch++; session.selected = id; change(); (panel.hidden ? toggle : selected).focus({ preventScroll: true }); } return true; }
    if (!canEnter()) return false;
    if (nodes[id].contains(target) && !visibleLayoutWidgets(getState().snapshot.preferences, activeProfile(), Boolean(document.fullscreenElement)).includes(id)) return false;
    origin = target; generation++; message = ''; clearFields(); view.lockReference();
    session.load(getState(), activeProfile(), id); active = true;
    toolbar.hidden = false; frames.hidden = false; panel.hidden = true; panelEpoch++; toggle.setAttribute('aria-expanded', 'false'); document.body.classList.add('dashboard-layout-editing');
    toggle.focus({ preventScroll: true });
    for (const node of Object.values(nodes)) { inert.set(node, node.inert); node.inert = true; }
    document.getElementById('open-settings').disabled = true; document.getElementById('edit-layout').disabled = true;
    change(); toggle.focus({ preventScroll: true }); return true;
  }
  async function submit(event) {
    event.preventDefault(); if (!active || pending || gesture || !commitRaw()) return;
    if (!session.changed()) { exit(); return; }
    if (session.revision === null || !getState().confirmed || getState().pending) return;
    const owner = generation; const source = getState().source; const payload = session.payload(); pending = true; message = getState().mode === 'local' ? 'Saving local layout…' : 'Saving shared layout…'; controls(); announce();
    try { await save(payload.preferences, payload.revision); if (!disposed && owner === generation) { pending = false; if (source === getState().source) exit(); else message = 'Settings scope changed. Reload layout before saving this draft.'; } }
    catch (error) { if (!disposed && owner === generation) { message = error.message || 'Shared layout could not be saved.'; } }
    finally { pending = false; if (!disposed && active && owner === generation) { render(); announce(); } }
  }
  get('form').addEventListener('submit', submit, options);
  for (const button of [toggle, close]) button.addEventListener('pointerdown', event => {
    // Keep a focused numeric field from committing on the native focus change before dismissal's click.
    if (event.button === 0 && event.isPrimary !== false) event.preventDefault();
  }, options);
  toggle.addEventListener('click', () => setPanel(panel.hidden), options);
  close.addEventListener('click', () => setPanel(false), options);
  get('cancel').addEventListener('click', () => { if (!pending) exit(); }, options);
  get('reload').addEventListener('click', () => { if (!active || pending || !getState().confirmed) return; cancelGesture(); clearFields(); session.load(getState(), session.mode); message = 'Shared layout reloaded; both profile drafts discarded.'; project(); announce(); }, options);
  get('reset').addEventListener('click', () => { if (active && !pending) { cancelGesture(); clearFields(); session.arrange('automatic'); change(); } }, options);
  get('fullscreen').addEventListener('click', () => { if (!pending) void toggleFullscreen(); }, options);
  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener('focus', () => { if (active && liveAutomatic() && !owned.has(key)) owned.set(key, displayed.get(key)); }, options);
    input.addEventListener('input', () => { if (!canEditWidget(session.selected)) return; if (liveAutomatic() && !owned.has(key)) owned.set(key, displayed.get(key)); input.setCustomValidity(''); raw.add(key); }, options);
    input.addEventListener('blur', () => { if (!raw.has(key)) owned.delete(key); }, options);
    input.addEventListener('change', () => {
      const epoch = panelEpoch; const widget = session.selected; const mode = session.mode;
      // Reject deferred field changes from a panel visibility transition or a dismissed session.
      queueMicrotask(() => { if (active && !pending && epoch === panelEpoch && widget === session.selected && mode === session.mode && raw.has(key) && !panel.hidden && ![toggle, close].includes(document.activeElement) && commit(key, false)) change(); });
    }, options);
  }
  for (const control of [profile, selected, arrangement]) control.addEventListener('change', () => {
    if (!active || pending) return;
    const value = control.value;
    if (control === selected && !canEditWidget(value)) { render(); return; }
    cancelGesture(); if (!commitRaw()) { render(); return; }
    clearFields(); panelEpoch++;
    if (control === profile) session.mode = value;
    else if (control === selected) session.selected = value;
    else session.arrange(value);
    change();
  }, options);
  function layerClick(event) {
    const button = event.target.closest('button[data-layer]');
    if (!active || pending || getState().pending || gesture || !button || button.disabled) return;
    const widget = button.dataset.layerWidget || session.selected;
    if (!canEditWidget(widget) || !commitRaw()) return;
    const focused = document.activeElement === button;
    session.layer(button.dataset.layer, widget, eligibleWidgets()); panelEpoch++; session.selected = widget; change();
    if (button.disabled && focused) {
      const alternative = button.parentElement.querySelector('button[data-layer]:not(:disabled)'); (alternative || toggle).focus({ preventScroll: true });
    }
  }
  toolbar.addEventListener('click', layerClick, options); frames.addEventListener('click', layerClick, options);
  frames.addEventListener('pointerdown', event => {
    const target = event.target.closest('button[data-action]');
    if (!active || pending || !target || target.disabled || gesture || activationBlocked() || event.button !== 0 || event.isPrimary === false || !canEditWidget(target.parentElement.dataset.widget) || !commitRaw()) return;
    panelEpoch++;
    session.selected = target.parentElement.dataset.widget;
    const frame = currentFrame(); if (!frame.fit) return;
    clearFields();
    gesture = { target, pointer: event.pointerId, saved: session.draft[session.mode], original: session.effective(), rect: widgetPixels(session.selected, frame.reference), automaticScreen: liveAutomatic() ? JSON.stringify(automatic?.screen) : undefined, frame: JSON.stringify(frame), scale: frame.fit.scale, x: event.clientX, y: event.clientY, action: target.dataset.action };
    target.setPointerCapture(event.pointerId); target.focus({ preventScroll: true }); event.preventDefault(); render();
  }, options);
  frames.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    if (!canEditWidget(session.selected)) { cancelGesture(); return; }
    const g = gesture; const dx = Math.round((event.clientX - g.x) / g.scale); const dy = Math.round((event.clientY - g.y) / g.scale);
    session.restore(g.saved); if (dx || dy) session.edit(g.action === 'move' ? { x: g.rect.x + dx, y: g.rect.y - dy } : { w: g.rect.w + dx, h: g.rect.h - dy }, view.reference(session.mode), g.original); project();
  }, options);
  frames.addEventListener('pointerup', event => { if (gesture?.pointer === event.pointerId) { if (!canEditWidget(session.selected)) { cancelGesture(); return; } const g = gesture; gesture = undefined; g.target.releasePointerCapture(g.pointer); change(); } }, options);
  frames.addEventListener('pointercancel', event => { if (gesture?.pointer === event.pointerId) cancelGesture(); }, options);
  frames.addEventListener('lostpointercapture', event => { if (gesture?.pointer === event.pointerId) cancelGesture(); }, options);
  function guard(event) { if (active && Object.values(nodes).some(node => node.contains(event.target))) { event.preventDefault(); event.stopImmediatePropagation(); } }
  for (const name of ['click', 'auxclick', 'dblclick', 'contextmenu', 'keydown', 'submit']) document.addEventListener(name, guard, { ...options, capture: true });
  document.addEventListener('keydown', event => {
    if (!active || event.key !== 'Escape') return;
    if (cancelGesture()) { event.preventDefault(); event.stopPropagation(); }
    else if (!panel.hidden && !pending && !getState().pending) { setPanel(false); event.preventDefault(); event.stopPropagation(); }
  }, options);
  function interrupt() { cancelGesture(); }
  for (const name of ['blur', 'resize', 'orientationchange', 'pagehide']) window.addEventListener(name, interrupt, options);
  window.addEventListener('scroll', () => { if (liveAutomatic()) cancelGesture(); }, { ...options, capture: true });
  document.addEventListener('fullscreenchange', interrupt, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); }, options);
  window.addEventListener('beforeunload', event => { if (unsaved() || pending) { event.preventDefault(); event.returnValue = ''; } }, options);
  return {
    enter, get active() { return active; }, cancelGesture,
    observe() { if (active) { render(); announce(); } },
    refreshSurface() {
      if (!active || painting || disposed) return;
      if (gesture && (JSON.stringify(currentFrame()) !== gesture.frame || liveAutomatic() && JSON.stringify(view.captureAutomatic(session.mode)?.screen) !== gesture.automaticScreen)) cancelGesture();
      if (livePreview !== liveAutomatic()) { project(); announce(); return; }
      if (!gesture) { if (liveAutomatic()) measureAutomatic(); else automatic = undefined; }
      render(); announce();
    },
    dispose() { if (disposed) return; pending = false; exit({ focus: false }); disposed = true; generation++; events.abort(); frames.replaceChildren(); get('layers').replaceChildren(); }
  };
}
