import { MAX_BOOKMARK_SELECTIONS, normalizeBookmarkSelections } from './bookmark-selection-data.js';

export function createBookmarkSelection({ document, root, foldersRoot, status, selectNone, onChange, onToggle, onRetry }) {
  let draft = new Map(); let configured = false; let state; let saving = false; let message = '';
  const rows = new Map(); const folderRows = new Map();
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  function changed() { configured = true; message = ''; onChange(); render(); }
  selectNone.addEventListener('click', () => { if (saving) return; draft.clear(); changed(); });

  function renderFolders(nodes, parent, retained, path = []) {
    for (const node of nodes) {
      const folder = state.folders[node.selectionId]; retained.add(node.selectionId);
      let row = folderRows.get(node.selectionId);
      if (!row) {
        const item = element('li'); const details = element('details'); const summary = element('summary'); const notice = element('p'); const retry = element('button', 'Reload folder'); const links = element('ul'); const children = element('ul');
        links.className = 'bookmark-picker-links'; details.dataset.selectionId = node.selectionId;
        retry.type = 'button'; details.append(summary, notice, retry, links, children); item.append(details);
        summary.addEventListener('click', (event) => { event.preventDefault(); onToggle(node.selectionId, !details.open); });
        retry.addEventListener('click', () => onRetry(node.selectionId));
        row = { item, details, summary, notice, retry, links, children }; folderRows.set(node.selectionId, row);
      }
      if (row.item.parentNode !== parent) parent.append(row.item);
      row.summary.textContent = node.name; row.details.open = folder.pickerOpen;
      row.notice.textContent = folder.error || (folder.loading ? 'Loading links…' : folder.evicted ? 'Catalog content evicted. Reload this folder.' : folder.budgetLimited ? 'Catalog content limited. Reload this folder.' : folder.truncated ? 'Provider result truncated.' : folder.loaded && !folder.bookmarks.length ? 'No bookmarks in this folder.' : folder.loaded ? `${folder.bookmarks.length} available links listed below.` : 'Open or reload this folder to list links.');
      if (folder.stale) row.notice.textContent += ' Saved links are stale.';
      row.retry.disabled = folder.loading || state.mutationPending; row.retry.setAttribute('aria-label', `Reload folder ${[...path, node.name].join(' / ')}`);
      renderFolders(node.children, row.children, retained, [...path, node.name]);
    }
  }

  function catalog() {
    const available = new Map();
    const walk = (nodes, path = []) => {
      for (const node of nodes) {
        const name = [...path, node.name].join(' / ');
        for (const link of state.folders[node.selectionId]?.bookmarks ?? []) {
          if (!available.has(link.selectionId)) available.set(link.selectionId, []);
          available.get(link.selectionId).push({ link, collectionSelectionId: node.selectionId, path: name });
        }
        walk(node.children, [...path, node.name]);
      }
    };
    if (state) walk(state.tree);
    return available;
  }

  function render() {
    const focused = document.activeElement;
    const retainedFolders = new Set(); if (state) renderFolders(state.tree, foldersRoot, retainedFolders);
    for (const [id, row] of folderRows) if (!retainedFolders.has(id)) { row.item.remove(); folderRows.delete(id); }
    const available = catalog(); const ids = new Set([...available.keys(), ...draft.keys()]);
    for (const id of ids) {
      let row = rows.get(id);
      if (!row) {
        const item = element('li'); const label = element('label'); label.className = 'toggle'; const input = element('input'); input.type = 'checkbox'; input.setAttribute('form', 'preferences'); const title = element('span'); const repairs = element('div'); label.append(input, title); item.append(label, repairs);
        input.addEventListener('change', () => {
          if (saving) { render(); return; }
          const candidate = catalog().get(id)?.[0];
          if (input.checked && draft.size >= MAX_BOOKMARK_SELECTIONS) { message = 'Select at most 256 links. Remove a selection before adding another.'; render(); return; }
          if (input.checked && candidate) draft.set(id, { selectionId: id, collectionSelectionId: candidate.collectionSelectionId });
          else draft.delete(id);
          changed();
        });
        row = { item, input, title, repairs, buttons: new Map() }; rows.set(id, row); root.append(item);
      }
      const candidates = available.get(id) ?? []; const chosen = draft.get(id);
      const candidate = candidates.find((value) => value.collectionSelectionId === chosen?.collectionSelectionId) ?? candidates[0];
      const parent = candidate ? folderRows.get(candidate.collectionSelectionId).links : root;
      if (row.item.parentNode !== parent) parent.append(row.item);
      row.title.textContent = candidate ? candidate.link.name : `Unavailable selected link ${id.slice(-8)} — reload folders or remove this choice`;
      row.input.setAttribute('aria-label', candidate ? `${candidate.link.name} · ${candidate.path} · ${id.slice(-8)}` : row.title.textContent);
      row.input.checked = Boolean(chosen); row.input.disabled = saving;
      const repairs = chosen ? candidates.filter((value) => value.collectionSelectionId !== chosen.collectionSelectionId) : [];
      const repaired = new Set();
      for (const location of repairs) {
        const folderId = location.collectionSelectionId; repaired.add(folderId);
        let button = row.buttons.get(folderId);
        if (!button) {
          button = element('button', 'Use this folder'); button.type = 'button'; row.repairs.append(button); row.buttons.set(folderId, button);
          button.addEventListener('click', () => {
            const existing = draft.get(id); const current = catalog().get(id)?.find((value) => value.collectionSelectionId === folderId);
            if (saving || !existing || !current || existing.collectionSelectionId === folderId) return;
            draft.set(id, { selectionId: id, collectionSelectionId: folderId }); changed();
          });
        }
        button.disabled = saving || state.mutationPending; button.setAttribute('aria-label', `Use this folder for ${location.link.name}: ${location.path}`);
      }
      for (const [folderId, button] of row.buttons) if (!repaired.has(folderId)) { if (document.activeElement === button) row.input.focus(); button.remove(); row.buttons.delete(folderId); }
    }
    for (const [id, row] of rows) if (!ids.has(id)) { if (row.item.contains(document.activeElement)) status.focus(); row.item.remove(); rows.delete(id); }
    selectNone.disabled = saving;
    status.textContent = message || (!state?.discovered ? 'Loading saved connection…' : state.needsReauthentication || state.accessDenied ? 'Reconnect Linkwarden to browse links. Existing choices are kept.' : !state.configured ? 'Connect Linkwarden to choose links. Existing choices are kept.' : state.error ? `${state.error} Existing choices are kept.` : `Select up to 256 links, then Save preferences. ${draft.size} selected. Open folders to browse; unavailable choices stay saved until removed.${state.limit ? ' Catalog content is limited; reload folders as needed.' : ''}`);
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  return {
    getDraft: () => configured ? normalizeBookmarkSelections([...draft.values()]) : null,
    setDraft(value) { const records = normalizeBookmarkSelections(value); configured = records !== null; draft = new Map((records ?? []).map((record) => [record.selectionId, record])); message = ''; render(); },
    setSaving(value) { saving = value; render(); },
    update(value) { state = value; render(); }
  };
}
