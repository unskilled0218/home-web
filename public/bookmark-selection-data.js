export const MAX_BOOKMARK_SELECTIONS = 256;
export const BOOKMARK_SELECTION_ID = /^b_[A-Za-z0-9_-]{43}$/;
// Persistent folder identities are SHA-256 digests, not the broader temporary-token format.
export const COLLECTION_SELECTION_ID = /^[A-Za-z0-9_-]{43}$/;

export function normalizeBookmarkSelections(value = null) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_BOOKMARK_SELECTIONS) throw new Error('Select at most 256 unique bookmark links.');
  const seen = new Set();
  const records = value.map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 2 || Object.keys(record).some((key) => !['selectionId', 'collectionSelectionId'].includes(key)) || typeof record.selectionId !== 'string' || !BOOKMARK_SELECTION_ID.test(record.selectionId) || typeof record.collectionSelectionId !== 'string' || !COLLECTION_SELECTION_ID.test(record.collectionSelectionId) || seen.has(record.selectionId)) throw new Error('Invalid bookmark link selections.');
    seen.add(record.selectionId);
    return { selectionId: record.selectionId, collectionSelectionId: record.collectionSelectionId };
  });
  return records.sort((left, right) => left.selectionId.localeCompare(right.selectionId));
}

export function selectedBookmarkProjection(state, selections) {
  const selected = new Set((selections ?? []).map((record) => record.selectionId));
  const found = new Set(); const folders = {};
  const walk = (nodes) => nodes.flatMap((node) => {
    const folder = state.folders[node.selectionId];
    const bookmarks = (folder?.bookmarks ?? []).filter((link) => selected.has(link.selectionId) && !found.has(link.selectionId) && (found.add(link.selectionId), true));
    const children = walk(node.children);
    if (!bookmarks.length && !children.length) return [];
    folders[node.selectionId] = { ...folder, bookmarks };
    return [{ ...node, children }];
  });
  const tree = walk(state.tree);
  const unresolved = (selections ?? []).filter((record) => !found.has(record.selectionId));
  const loading = unresolved.some((record) => { const folder = state.folders[record.collectionSelectionId]; return folder && (folder.attempted === null || folder.loading) && !folder.error; });
  let selectionMessage = selections === null ? 'Choose links in Settings → Bookmarks.' : !selections.length ? 'No bookmark links selected.' : unresolved.length ? `${unresolved.length} selected link${unresolved.length === 1 ? '' : 's'} ${loading ? 'loading' : 'unavailable or not yet found'}. Open Settings → Bookmarks to reload folders or repair moved links.` : '';
  if (unresolved.some((record) => state.folders[record.collectionSelectionId]?.budgetLimited)) selectionMessage += ' Selected content could not fit within the dashboard cache limit.';
  if (unresolved.some((record) => state.folders[record.collectionSelectionId]?.truncated)) selectionMessage += ' The provider folder result was truncated; unseen links are not confirmed missing.';
  return { ...state, tree, folders, selectionMessage, unresolved, selectionLoading: loading };
}
