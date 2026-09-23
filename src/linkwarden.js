import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_BOOKMARK_PAGES = 100;
const BODYLESS_STATUSES = new Set([204, 205, 304]);

function fetchLinkwarden(url, { headers, signal } = {}, redirects = 0) {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const options = { headers, signal, ...(parsed.protocol === 'https:' && { rejectUnauthorized: false }) };
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
          resolve(fetchLinkwarden(target, { headers, signal }, redirects + 1));
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

function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
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
  const entries = payload?.response ?? payload?.data ?? [];
  if (!Array.isArray(entries)) throw new Error('Linkwarden returned an invalid collection list.');
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
  const sort = (items) => { items.sort(compare); for (const item of items) sort(item.children); };
  sort(roots);
  return roots;
}

async function boundedJson(response, limit = MAX_RESPONSE_BYTES) {
  if (!response.ok) throw new Error('Linkwarden request failed.');
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('Linkwarden response is too large.');
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > limit) throw new Error('Linkwarden response is too large.'); chunks.push(value); }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

export function createLinkwardenClient({ fetchImpl = fetchLinkwarden, timeoutMs = 8_000, cacheSeconds = 60 } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let cacheGeneration = 0;
  const request = async (url, accessToken) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: controller.signal });
      return boundedJson(response);
    } finally { clearTimeout(timer); }
  };
  const refresh = async ({ baseUrl, collectionId, accessToken }, generation) => {
    const key = `${baseUrl}:${collectionId}`;
    const bookmarks = [];
    const bookmarkIds = new Set();
    const seenCursors = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_BOOKMARK_PAGES; page += 1) {
      const url = new URL('/api/v1/search', baseUrl);
      url.searchParams.set('collectionId', collectionId);
      if (cursor != null) url.searchParams.set('cursor', cursor);
      const payload = await request(url.href, accessToken);
      for (const bookmark of normalizeBookmarks(payload)) {
        if (bookmarkIds.has(bookmark.id)) continue;
        bookmarkIds.add(bookmark.id);
        bookmarks.push(bookmark);
      }
      const nextCursor = nextBookmarkCursor(payload);
      if (nextCursor == null) break;
      if (seenCursors.has(nextCursor)) throw new Error('Linkwarden returned a repeated bookmark cursor.');
      if (page === MAX_BOOKMARK_PAGES - 1) throw new Error('Linkwarden returned too many bookmark pages.');
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    if (generation === cacheGeneration) cache.set(key, { bookmarks, fetchedAt: Date.now() });
    return { bookmarks, stale: false };
  };
  return {
    clearCache: () => { cacheGeneration += 1; cache.clear(); inFlight.clear(); },
    async listCollections({ baseUrl, accessToken }) {
      const payload = await request(new URL('/api/v1/collections', baseUrl).href, accessToken);
      return buildCollectionTree(normalizeCollections(payload));
    },
    async getBookmarks(settings, { force = false } = {}) {
      const key = `${settings.baseUrl}:${settings.collectionId}`;
      const cached = cache.get(key);
      if (!force && cached && Date.now() - cached.fetchedAt < cacheSeconds * 1_000) return { bookmarks: cached.bookmarks, stale: false };
      const generation = cacheGeneration;
      const promise = inFlight.get(key) ?? refresh(settings, generation);
      inFlight.set(key, promise);
      try { return await promise; } catch { if (cached) return { bookmarks: cached.bookmarks, stale: true }; throw new Error('Linkwarden is currently unavailable.'); } finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
    },
    test: (settings) => refresh(settings, cacheGeneration)
  };
}
