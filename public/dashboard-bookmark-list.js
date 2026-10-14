import { safeBookmarkUrl } from './bookmark-data.js';

export function createBookmarkList({ root, status, onRetry }) {
  const nodes = new Map();
  const element = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
  function create(id) {
    const item = element('li'); const link = element('a', 'bookmark-link'); const message = element('p', 'bookmark-folder-status'); const retry = element('button', 'bookmark-retry');
    retry.type = 'button'; retry.textContent = 'Retry link'; item.append(link, message, retry);
    const entry = { item, link, message, retry, folderId: null };
    retry.addEventListener('click', () => onRetry(entry.folderId)); nodes.set(id, entry); return entry;
  }
  return {
    render(state) {
      status.textContent = state.needsReauthentication ? 'Linkwarden needs re-authentication. Open Settings → Bookmarks.' : state.accessDenied ? 'Linkwarden access was denied. Reconnect in Settings → Bookmarks.' : state.error ? `${state.error}${state.tree.length ? ' Showing the saved tree.' : ''}` : !state.discovered ? 'Checking Linkwarden connection…' : !state.configured ? state.encryptionReady ? 'Connect Linkwarden in Settings → Bookmarks.' : 'Configure the server encryption key to connect Linkwarden.' : state.loadingTree && !state.tree.length ? 'Loading bookmark folders…' : !state.tree.length ? 'No bookmark collections.' : state.treeStale ? 'The collection tree is stale.' : state.limit ? 'The dashboard bookmark limit was reached. Open Linkwarden for the full account.' : '';
      if (state.selectionMessage && state.configured && !state.needsReauthentication && !state.accessDenied && !state.error) status.textContent = state.selectionMessage;
      const focused = document.activeElement; const retained = new Set(); let previous = null;
      for (const bookmark of state.bookmarks) {
        const url = safeBookmarkUrl(bookmark.url); if (!url) continue;
        const id = bookmark.selectionId; retained.add(id); const entry = nodes.get(id) ?? create(id);
        const expected = previous ? previous.nextElementSibling : root.firstElementChild;
        if (expected !== entry.item) root.insertBefore(entry.item, expected); previous = entry.item;
        entry.link.href = url; entry.link.textContent = bookmark.name; entry.link.target = '_blank'; entry.link.rel = 'noopener noreferrer';
        entry.folderId = state.linkFolders[id]; const folder = state.folders[entry.folderId];
        entry.message.textContent = [folder.error, folder.stale && 'Bookmarks are stale.', folder.truncated && 'The provider result was truncated.', folder.budgetLimited && 'The dashboard content limit was reached.'].filter(Boolean).join(' ');
        entry.message.hidden = !entry.message.textContent; entry.retry.hidden = !folder.error; entry.retry.disabled = folder.loading || state.mutationPending; entry.retry.setAttribute('aria-label', `Retry link ${bookmark.name}`);
      }
      for (const [id, entry] of nodes) if (!retained.has(id)) { entry.item.remove(); nodes.delete(id); }
      if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }
  };
}
