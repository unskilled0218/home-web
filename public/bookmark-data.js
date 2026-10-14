import { BOOKMARK_SELECTION_ID } from './bookmark-selection-data.js';

export const MAX_COLLECTIONS = 256;
export const MAX_COLLECTION_DEPTH = 16;
export const MAX_FOLDER_BOOKMARKS = 2000;
export const MAX_FOLDER_BYTES = 2 * 1024 * 1024;
export const MAX_BROWSER_BOOKMARKS = 10000;
export const MAX_BROWSER_BYTES = 8 * 1024 * 1024;
export const MAX_BOOKMARK_RESPONSE_BYTES = 3 * 1024 * 1024;
export const BOOKMARK_REFRESH_MS = 300000;
export const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const bookmarkError = (message, code) => Object.assign(new Error(message), { code });

export function assertCollectionBounds(tree) {
  if (!Array.isArray(tree)) throw bookmarkError('Invalid collection tree.', 'INVALID_COLLECTION_TREE');
  const stack = tree.map((node) => ({ node, depth: 1 })); const seen = new Set();
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node || seen.has(node) || !Array.isArray(node.children)) throw bookmarkError('Invalid collection tree.', 'INVALID_COLLECTION_TREE');
    seen.add(node);
    if (seen.size > MAX_COLLECTIONS || depth > MAX_COLLECTION_DEPTH) throw bookmarkError('Linkwarden supports at most 256 collections and 16 folder levels on this dashboard.', 'COLLECTION_LIMIT');
    for (const child of node.children) stack.push({ node: child, depth: depth + 1 });
  }
}

export function normalizeCollectionTree(tree) {
  assertCollectionBounds(tree); const ids = new Set();
  const walk = (node) => {
    if (typeof node.selectionId !== 'string' || typeof node.collectionToken !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(node.selectionId) || !/^[A-Za-z0-9_-]{16,128}$/.test(node.collectionToken) || typeof node.name !== 'string' || !node.name.trim() || node.name.length > 300 || ids.has(node.selectionId)) throw bookmarkError('Invalid collection identity.', 'INVALID_COLLECTION_TREE');
    ids.add(node.selectionId);
    return { selectionId: node.selectionId, collectionToken: node.collectionToken, name: node.name.trim(), children: node.children.map(walk) };
  };
  return tree.map(walk);
}

export function safeBookmarkUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function normalizeBookmarkLinks(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_FOLDER_BOOKMARKS) throw bookmarkError('Invalid bookmark list.', 'INVALID_BOOKMARKS');
  const seen = new Set();
  return rows.flatMap((row) => {
    const url = safeBookmarkUrl(row?.url);
    if (!url || !Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id)) return [];
    if (typeof row.selectionId !== 'string' || !BOOKMARK_SELECTION_ID.test(row.selectionId)) throw bookmarkError('Invalid bookmark identity.', 'INVALID_BOOKMARKS');
    seen.add(row.id);
    return [{ id: row.id, selectionId: row.selectionId, name: (typeof row.name === 'string' && row.name.trim() ? row.name.trim() : url).slice(0, 300), url }];
  });
}

export const bookmarkProfile = (mobile, mode) => mobile ? `mobile-${mode === 'expanded' ? 'expanded' : 'compact'}` : 'desktop-expanded';
export const defaultFolderOpen = (profile, depth) => profile !== 'mobile-compact' || depth === 0;
