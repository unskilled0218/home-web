import { WIDGET_ELEMENTS } from './dashboard-layout.js';

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, iframe, object, embed, audio, video, [tabindex], [draggable=true], [contenteditable]:not([contenteditable=false]), [role=button], [role=link], [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=tab], [role=treeitem], [role=slider], [role=spinbutton], [role=combobox], [role=listbox], [role=textbox], [role=searchbox], [role=radio]';

export function createLayoutActivation({ document, window, canEnter, activate, schedule = setTimeout, cancel = clearTimeout }) {
  const events = new AbortController(); const options = { capture: true, signal: events.signal };
  let pending; let consumed; let timer; let releaseTimer; let generation = 0; let disposed = false;
  const widgets = new Map(Object.entries(WIDGET_ELEMENTS).map(([id, element]) => [document.getElementById(element), id]));
  function eligible(node, path) {
    const ancestors = path || [];
    if (!path) for (let current = node; current; current = current.parentElement) ancestors.push(current);
    for (const current of ancestors) {
      if (widgets.has(current)) return { node: current, id: widgets.get(current) };
      if (current.matches?.(INTERACTIVE)) return null;
    }
    return null;
  }
  function stop() { generation++; cancel(timer); timer = undefined; pending?.node.classList.remove('layout-hold-pending'); pending = undefined; }
  function clearConsumed() { cancel(releaseTimer); consumed = undefined; }
  function down(event) {
    if (consumed?.released) clearConsumed();
    if (pending || consumed) { stop(); return; }
    if (disposed || event.button !== 0 || event.isPrimary === false || !canEnter() || document.hidden || window.getSelection?.()?.isCollapsed === false) return;
    const target = eligible(event.target, event.composedPath?.());
    if (!target || !target.node.isConnected || !target.node.getClientRects().length) return;
    pending = { ...target, pointer: event.pointerId, x: event.clientX, y: event.clientY };
    target.node.classList.add('layout-hold-pending'); const owner = ++generation;
    timer = schedule(() => {
      const hold = pending;
      if (disposed || owner !== generation || !hold) return;
      const hit = eligible(document.elementFromPoint(hold.x, hold.y));
      stop();
      if (!canEnter() || document.hidden || window.getSelection?.()?.isCollapsed === false || !hold.node.isConnected || !hold.node.getClientRects().length || hit?.node !== hold.node) return;
      consumed = hold;
      // Bounded even if the browser loses the terminating pointer event.
      releaseTimer = schedule(clearConsumed, 10000);
      if (!activate(hold.id, hold.node)) clearConsumed();
    }, 600);
  }
  function move(event) { if (pending && pending.pointer === event.pointerId && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 8) stop(); }
  function up(event) {
    if (pending?.pointer === event.pointerId) stop();
    if (consumed?.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation(); consumed.released = true; consumed.releaseX = event.clientX; consumed.releaseY = event.clientY;
    cancel(releaseTimer); releaseTimer = schedule(clearConsumed, 800);
  }
  function suppress(event) {
    const hold = consumed || pending;
    if (!hold) return;
    const sameLocation = Math.hypot(event.clientX - (hold.releaseX ?? hold.x), event.clientY - (hold.releaseY ?? hold.y)) < 8;
    const context = event.type === 'contextmenu' && (eligible(event.target)?.node === hold.node || (consumed && sameLocation));
    const click = event.type === 'click' && consumed?.released && event.detail !== 0 && sameLocation && (event.pointerId === undefined || event.pointerId <= 0 || event.pointerId === hold.pointer);
    if (context || click) { event.preventDefault(); event.stopImmediatePropagation(); if (click) clearConsumed(); }
  }
  function interrupted(event) { if (event.type !== 'visibilitychange' || document.hidden) { stop(); clearConsumed(); } }
  document.addEventListener('pointerdown', down, options); document.addEventListener('pointermove', move, options); document.addEventListener('pointerup', up, options);
  document.addEventListener('pointercancel', interrupted, options); document.addEventListener('scroll', stop, { ...options, passive: true });
  document.addEventListener('click', suppress, options); document.addEventListener('contextmenu', suppress, options); document.addEventListener('visibilitychange', interrupted, options);
  window.addEventListener('blur', interrupted, options); window.addEventListener('pagehide', interrupted, options);
  return { blocked: () => Boolean(consumed && !consumed.released), cancel: stop, dispose() { disposed = true; stop(); clearConsumed(); events.abort(); } };
}
