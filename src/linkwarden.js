import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { assertCollectionBounds, bookmarkError, jsonBytes, MAX_COLLECTIONS, MAX_FOLDER_BOOKMARKS, MAX_FOLDER_BYTES, safeBookmarkUrl as safeUrl } from '../public/bookmark-data.js';

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_BOOKMARK_PAGES = 100;
const BODYLESS_STATUSES = new Set([204, 205, 304]);

function fetchLinkwarden(url, { headers, signal, ca } = {}, redirects = 0) {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const options = { headers, signal, ...(parsed.protocol === 'https:' && ca && { ca }) };
  return new Promise((resolve, reject) => {
    const request = transport.get(parsed, options, (response) => {
      try {
        const status = response.statusCode;
        if (!Number.isInteger(status) || status < 200 || status > 599) { response.resume(); reject(new Error('Linkwarden returned an invalid HTTP status.')); return; }
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          const target = new URL(response.headers.location, parsed);
          response.resume();
          if (target.origin !== parsed.origin) { reject(new Error('Linkwarden returned a cross-origin redirect.')); return; }
          if (redirects >= 5) { reject(new Error('Linkwarden returned too many redirects.')); return; }
          resolve(fetchLinkwarden(target, { headers, signal, ca }, redirects + 1));
          return;
        }
        const body = BODYLESS_STATUSES.has(status) ? null : Readable.toWeb(response);
        if (body === null) response.resume();
        resolve(new Response(body, { status, statusText: response.statusMessage, headers: response.headers }));
      } catch (error) {
        response.resume();
        reject(error);
      }
    });
    request.on('error', reject);
    request.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Linkwarden returned an unsupported protocol upgrade.')); });
  });
}

export function normalizeLinkwardenCredentials(input, existing = null) {
  let url;
  try { url = new URL(typeof input.url === 'string' ? input.url.trim() : ''); } catch { throw new Error('Linkwarden URL must be an absolute http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Linkwarden URL must be an absolute http or https URL.');
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!username || username.length > 120) throw new Error('Username is required and must be at most 120 characters.');
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  if (!accessToken && !existing) throw new Error('An access token is required to connect Linkwarden.');
  if (accessToken.length > 2_000) throw new Error('Access token is too long.');
  return { baseUrl: url.href.replace(/\/$/, ''), username, accessToken: accessToken || null };
}

export function normalizeBookmarks(payload) {
  let entries;
  if (Array.isArray(payload)) entries = payload;
  else if (payload && Object.hasOwn(payload, 'data')) {
    if (payload.data && !Array.isArray(payload.data) && Object.hasOwn(payload.data, 'links')) entries = payload.data.links;
    else entries = payload.data;
  } else if (payload && Object.hasOwn(payload, 'response')) entries = payload.response;
  else if (payload && Object.hasOwn(payload, 'bookmarks')) entries = payload.bookmarks;
  if (!Array.isArray(entries)) throw new Error('Linkwarden returned an invalid bookmark list.');
  return entries.flatMap((bookmark) => {
    const url = safeUrl(bookmark?.url);
    const id = Number(bookmark?.id);
    const providedName = typeof bookmark?.name === 'string' ? bookmark.name.trim() : '';
    const name = (providedName || url || '').slice(0, 300);
    if (!url || !name || !Number.isSafeInteger(id) || id < 1) return [];
    const description = typeof bookmark.description === 'string' && bookmark.description.trim() ? bookmark.description.trim().slice(0, 1_000) : undefined;
    const tags = Array.isArray(bookmark.tags) ? bookmark.tags.map((tag) => typeof tag === 'string' ? tag : tag?.name).filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim().slice(0, 80)).slice(0, 20) : undefined;
    const favicon = safeUrl(bookmark?.favicon);
    return [{ id, name, url, ...(description && { description }), ...(tags?.length && { tags }), ...(favicon && { favicon }) }];
  });
}

function nextBookmarkCursor(payload) {
  if (!payload?.data || Array.isArray(payload.data) || !Array.isArray(payload.data.links)) return null;
  const rawCursor = payload.data.nextCursor;
  if (rawCursor == null) return null;
  if (typeof rawCursor !== 'number' || !Number.isSafeInteger(rawCursor) || rawCursor < 0) throw new Error('Linkwarden returned an invalid bookmark cursor.');
  return rawCursor;
}

export function normalizeCollections(payload) {
  const entries = payload?.response ?? payload?.data;
  if (!Array.isArray(entries)) throw new Error('Linkwarden returned an invalid collection list.');
  if (entries.length > MAX_COLLECTIONS) throw bookmarkError('Linkwarden supports at most 256 collections on this dashboard.', 'COLLECTION_LIMIT');
  const seen = new Set();
  return entries.flatMap((collection) => {
    const id = Number(collection?.id);
    const name = typeof collection?.name === 'string' ? collection.name.trim().slice(0, 300) : '';
    if (!Number.isSafeInteger(id) || id < 1 || !name || seen.has(id)) return [];
    seen.add(id);
    const rawParentId = collection?.parentId ?? collection?.parent?.id;
    const parentId = rawParentId == null ? null : Number(rawParentId);
    return [{ id, name, parentId: Number.isSafeInteger(parentId) && parentId > 0 && parentId !== id ? parentId : null }];
  });
}

export function buildCollectionTree(collections) {
  if (collections.length > MAX_COLLECTIONS) throw bookmarkError('Linkwarden supports at most 256 collections on this dashboard.', 'COLLECTION_LIMIT');
  const nodes = new Map(collections.map((collection) => [collection.id, { ...collection, children: [] }]));
  const invalidParents = new Set();
  for (const node of nodes.values()) {
    if (node.parentId != null && !nodes.has(node.parentId)) invalidParents.add(node.id);
    const seen = new Set([node.id]);
    const chain = [node.id];
    let parentId = node.parentId;
    while (parentId != null && nodes.has(parentId)) {
      if (seen.has(parentId)) { for (const id of chain) invalidParents.add(id); break; }
      seen.add(parentId);
      chain.push(parentId);
      parentId = nodes.get(parentId).parentId;
    }
  }
  for (const id of invalidParents) nodes.get(id).parentId = null;
  const compare = (left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id - right.id;
  const roots = [];
  for (const node of nodes.values()) (node.parentId == null ? roots : nodes.get(node.parentId).children).push(node);
  assertCollectionBounds(roots);
  const sort = (items) => { items.sort(compare); for (const item of items) sort(item.children); };
  sort(roots);
  return roots;
}

async function boundedJson(response, limit = MAX_RESPONSE_BYTES, signal) {
  if (!response.ok) throw bookmarkError(response.status === 401 ? 'Linkwarden needs re-authentication.' : response.status === 403 ? 'Linkwarden access was denied.' : 'Linkwarden request failed.', response.status === 401 ? 'LINKWARDEN_AUTHENTICATION_REQUIRED' : response.status === 403 ? 'LINKWARDEN_ACCESS_DENIED' : 'LINKWARDEN_UNAVAILABLE');
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('Linkwarden response is too large.');
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const chunks = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > limit) throw new Error('Linkwarden response is too large.'); chunks.push(value); }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}

export function createLinkwardenClient({ fetchImpl = fetchLinkwarden, timeoutMs = 8_000, collectionTimeoutMs = 20_000, cacheSeconds = 60, cacheBytes = 32 * 1024 * 1024, cacheEntries = 64, now = Date.now, schedule = setTimeout, cancel = clearTimeout, ca } = {}) {
  if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 1 || !Number.isSafeInteger(cacheEntries) || cacheEntries < 1) throw new Error('Linkwarden cache limits must be positive integers.');
  const cache = new Map();
  const inFlight = new Map();
  const readers = new Set();
  let cacheGeneration = 0; let bytes = 0;
  const drop = (key) => { const row = cache.get(key); if (row) bytes -= row.bytes; cache.delete(key); };
  function clearCache(reason = 'LINKWARDEN_CONFIGURATION_CHANGED') {
    cacheGeneration++; cache.clear(); bytes = 0; inFlight.clear();
    for (const reader of readers) if (!reader.provisional) reader.controller.abort(bookmarkError('Linkwarden source changed.', reason));
  }
  const request = async (url, accessToken, { signal, provisional = false } = {}) => {
    const controller = new AbortController();
    const entry = { controller, provisional }; readers.add(entry);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = schedule(() => controller.abort(new Error('Linkwarden request exceeded its timeout.')), timeoutMs);
    let response;
    try {
      const interrupted = new Promise((_resolve, reject) => { if (controller.signal.aborted) reject(controller.signal.reason); else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); });
      return await Promise.race([(async () => {
        response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: controller.signal, ca });
        if (controller.signal.aborted) { await response.body?.cancel().catch(() => {}); throw controller.signal.reason; }
        return await boundedJson(response, MAX_RESPONSE_BYTES, controller.signal);
      })(), interrupted]);
    } catch (error) {
      controller.abort(error);
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      throw error;
    } finally { cancel(timer); readers.delete(entry); signal?.removeEventListener('abort', abort); }
  };
  function remember(key, result) {
    drop(key); const size = jsonBytes(result);
    if (size > cacheBytes) return;
    while (cache.size >= cacheEntries || bytes + size > cacheBytes) drop(cache.keys().next().value);
    cache.set(key, { ...result, fetchedAt: now(), bytes: size }); bytes += size;
  }
  const refresh = async ({ baseUrl, collectionId, accessToken }, generation) => {
    const key = `${baseUrl}:${collectionId}`;
    const bookmarks = [];
    const bookmarkIds = new Set();
    const seenCursors = new Set();
    let cursor = null; let size = 2; let truncated = false;
    const controller = new AbortController();
    const deadline = schedule(() => controller.abort(new Error('Linkwarden bookmark retrieval exceeded its timeout.')), collectionTimeoutMs);
    try {
      for (let page = 0; page < MAX_BOOKMARK_PAGES; page += 1) {
        const url = new URL('/api/v1/search', baseUrl);
        url.searchParams.set('collectionId', collectionId);
        if (cursor != null) url.searchParams.set('cursor', cursor);
        const payload = await request(url.href, accessToken, { signal: controller.signal });
        if (generation !== cacheGeneration) throw bookmarkError('Linkwarden source changed.', 'LINKWARDEN_CONFIGURATION_CHANGED');
        for (const bookmark of normalizeBookmarks(payload)) {
          if (bookmarkIds.has(bookmark.id)) continue;
          const added = jsonBytes(bookmark) + (bookmarks.length ? 1 : 0);
          if (bookmarks.length >= MAX_FOLDER_BOOKMARKS || size + added > MAX_FOLDER_BYTES) { truncated = true; break; }
          bookmarkIds.add(bookmark.id);
          bookmarks.push(bookmark); size += added;
        }
        const nextCursor = nextBookmarkCursor(payload);
        if (truncated || (nextCursor != null && bookmarks.length >= MAX_FOLDER_BOOKMARKS)) { truncated = true; break; }
        if (nextCursor == null) break;
        if (seenCursors.has(nextCursor)) throw new Error('Linkwarden returned a repeated bookmark cursor.');
        if (page === MAX_BOOKMARK_PAGES - 1) throw new Error('Linkwarden returned too many bookmark pages.');
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      const result = { bookmarks, stale: false, ...(truncated && { truncated: true }) };
      if (generation !== cacheGeneration) throw bookmarkError('Linkwarden source changed.', 'LINKWARDEN_CONFIGURATION_CHANGED');
      remember(key, result); return result;
    } finally { cancel(deadline); }
  };
  return {
    clearCache,
    async listCollections({ baseUrl, accessToken }, { provisional = false } = {}) {
      const generation = cacheGeneration;
      try {
        const payload = await request(new URL('/api/v1/collections', baseUrl).href, accessToken, { provisional });
        if (!provisional && generation !== cacheGeneration) throw bookmarkError('Linkwarden source changed.', 'LINKWARDEN_CONFIGURATION_CHANGED');
        return buildCollectionTree(normalizeCollections(payload));
      } catch (error) {
        if (!provisional && ['LINKWARDEN_AUTHENTICATION_REQUIRED', 'LINKWARDEN_ACCESS_DENIED'].includes(error.code)) clearCache(error.code);
        throw error;
      }
    },
    async getBookmarks(settings, { force = false } = {}) {
      const key = `${settings.baseUrl}:${settings.collectionId}`;
      const cached = cache.get(key);
      if (!force && cached && now() - cached.fetchedAt < cacheSeconds * 1_000) {
        cache.delete(key); cache.set(key, cached);
        return { bookmarks: cached.bookmarks, stale: false, ...(cached.truncated && { truncated: true }) };
      }
      const generation = cacheGeneration;
      const promise = inFlight.get(key) ?? refresh(settings, generation);
      inFlight.set(key, promise);
      try { return await promise; }
      catch (error) {
        if (error.code === 'LINKWARDEN_AUTHENTICATION_REQUIRED') { if (generation === cacheGeneration) clearCache(error.code); throw error; }
        if (error.code === 'LINKWARDEN_ACCESS_DENIED') { if (generation === cacheGeneration) drop(key); throw error; }
        if (generation !== cacheGeneration || error.code === 'LINKWARDEN_CONFIGURATION_CHANGED') throw bookmarkError('Linkwarden source changed.', 'LINKWARDEN_CONFIGURATION_CHANGED');
        if (cached) return { bookmarks: cached.bookmarks, stale: true, ...(cached.truncated && { truncated: true }) };
        throw bookmarkError('Linkwarden is currently unavailable.', 'LINKWARDEN_UNAVAILABLE');
      } finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
    },
    test: (settings) => refresh(settings, cacheGeneration)
  };
}
