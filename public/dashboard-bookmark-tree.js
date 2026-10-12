import { safeBookmarkUrl } from './bookmark-data.js';

export function createBookmarkTree({ root, status, onToggle, onRetry }) {
  const nodes = new Map(); let latest;
  const element = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
  function create(id) {
    const item = element('li', 'bookmark-folder'); const details = element('details'); const summary = element('summary');
    const message = element('p', 'bookmark-folder-status'); const retry = element('button', 'bookmark-retry'); const links = element('ul', 'bookmark-links'); const children = element('ul', 'bookmark-children');
    details.dataset.selectionId = id; retry.type = 'button'; retry.textContent = 'Retry folder';
    details.append(summary, message, retry, links, children); item.append(details);
    // Capture intent before an asynchronous sibling update can reset the native open state.
    summary.addEventListener('click', (event) => { event.preventDefault(); onToggle(id, !details.open); });
    details.addEventListener('toggle', () => { const expected = latest?.folders[id]; if (expected && details.open !== expected.open) onToggle(id, details.open); });
    retry.addEventListener('click', () => onRetry(id));
    const entry = { item, details, summary, message, retry, links, children, linkNodes: new Map() }; nodes.set(id, entry); return entry;
  }
  function renderList(list, collections, retained) {
    let previous = null;
    for (const collection of collections) {
      const id = collection.selectionId; const folder = latest.folders[id]; if (!folder) continue;
      retained.add(id); const entry = nodes.get(id) ?? create(id);
      const expected = previous ? previous.nextElementSibling : list.firstElementChild;
      if (expected !== entry.item) list.insertBefore(entry.item, expected);
      previous = entry.item;
      entry.summary.textContent = collection.name; entry.details.style.setProperty('--folder-depth', folder.depth);
      if (entry.details.open !== folder.open) entry.details.open = folder.open;
      entry.message.textContent = folder.error ? `${folder.error}${folder.loaded ? ' Showing saved bookmarks.' : ''}` : folder.loading ? 'Loading bookmarks…' : folder.loaded && !folder.bookmarks.length && !folder.truncated && !folder.budgetLimited ? 'No bookmarks in this folder.' : '';
      const notices = [folder.stale && 'Bookmarks are stale.', folder.truncated && 'This folder reached the dashboard bookmark limit.', folder.budgetLimited && 'The dashboard content limit was reached.'];
      for (const notice of notices.filter(Boolean)) entry.message.textContent += `${entry.message.textContent ? ' ' : ''}${notice}`;
      entry.message.hidden = !entry.message.textContent; entry.retry.hidden = !folder.error; entry.retry.disabled = folder.loading || latest.mutationPending;
      entry.retry.setAttribute('aria-label', `Retry folder ${collection.name}`);
      if (entry.bookmarks !== folder.bookmarks) {
        entry.bookmarks = folder.bookmarks;
        const kept = new Set(); let previousLink = null;
        for (const bookmark of folder.bookmarks) {
          const url = safeBookmarkUrl(bookmark.url); if (!url) continue;
          let row = entry.linkNodes.get(bookmark.id);
          if (!row) { const item = element('li'); const link = element('a', 'bookmark-link'); item.append(link); row = { item, link }; entry.linkNodes.set(bookmark.id, row); }
          row.link.href = url; row.link.textContent = bookmark.name; kept.add(bookmark.id);
          const expectedLink = previousLink ? previousLink.nextElementSibling : entry.links.firstElementChild;
          if (expectedLink !== row.item) entry.links.insertBefore(row.item, expectedLink);
          previousLink = row.item;
        }
        for (const [id, row] of entry.linkNodes) if (!kept.has(id)) { row.item.remove(); entry.linkNodes.delete(id); }
      }
      renderList(entry.children, collection.children, retained);
    }
  }
  return {
    render(state) {
      latest = state;
      status.textContent = state.needsReauthentication ? 'Linkwarden needs re-authentication. Open Settings → Bookmarks.' : state.accessDenied ? 'Linkwarden access was denied. Reconnect in Settings → Bookmarks.' : state.error ? `${state.error}${state.tree.length ? ' Showing the saved tree.' : ''}` : !state.discovered ? 'Checking Linkwarden connection…' : !state.configured ? state.encryptionReady ? 'Connect Linkwarden in Settings → Bookmarks.' : 'Configure the server encryption key to connect Linkwarden.' : state.loadingTree && !state.tree.length ? 'Loading bookmark folders…' : !state.tree.length ? 'No bookmark collections.' : state.treeStale ? 'The collection tree is stale.' : state.limit ? 'The dashboard bookmark limit was reached. Open Linkwarden for the full account.' : '';
      const focused = document.activeElement; const retained = new Set(); renderList(root, state.tree, retained);
      for (const [id, entry] of nodes) if (!retained.has(id)) { entry.item.remove(); nodes.delete(id); }
      if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }
  };
}
