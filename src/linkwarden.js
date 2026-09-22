import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const MAX_RESPONSE_BYTES = 1_000_000;

function fetchLinkwarden(url, { headers, signal } = {}, redirects = 0) {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const options = { headers, signal, ...(parsed.protocol === 'https:' && { rejectUnauthorized: false }) };
  return new Promise((resolve, reject) => {
    const request = transport.get(parsed, options, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        const target = new URL(response.headers.location, parsed);
        response.resume();
        if (target.origin !== parsed.origin) { reject(new Error('Linkwarden returned a cross-origin redirect.')); return; }
        if (redirects >= 5) { reject(new Error('Linkwarden returned too many redirects.')); return; }
        resolve(fetchLinkwarden(target, { headers, signal }, redirects + 1));
        return;
      }
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode ?? 500, statusText: response.statusMessage, headers: response.headers }));
    });
    request.on('error', reject);
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
  const entries = Array.isArray(payload) ? payload : payload?.response ?? payload?.data ?? payload?.bookmarks ?? [];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((bookmark) => {
    const url = safeUrl(bookmark?.url);
    const name = typeof bookmark?.name === 'string' ? bookmark.name.trim().slice(0, 300) : '';
    if (!url || !name || !Number.isSafeInteger(Number(bookmark.id))) return [];
    const description = typeof bookmark.description === 'string' && bookmark.description.trim() ? bookmark.description.trim().slice(0, 1_000) : undefined;
    const tags = Array.isArray(bookmark.tags) ? bookmark.tags.map((tag) => typeof tag === 'string' ? tag : tag?.name).filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim().slice(0, 80)).slice(0, 20) : undefined;
    const favicon = safeUrl(bookmark?.favicon);
    return [{ id: Number(bookmark.id), name, url, ...(description && { description }), ...(tags?.length && { tags }), ...(favicon && { favicon }) }];
  });
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
    const origin = new URL(baseUrl).origin;
    let next = new URL(`/api/v1/collections/${collectionId}/bookmarks`, baseUrl).href;
    const bookmarks = [];
    while (next) {
      const payload = await request(next, accessToken);
      bookmarks.push(...normalizeBookmarks(payload));
      const candidate = payload?.next ?? payload?.meta?.next_page_url ?? payload?.links?.next;
      if (!candidate) break;
      const parsed = new URL(candidate, next);
      if (parsed.origin !== origin) throw new Error('Linkwarden returned an invalid pagination link.');
      next = parsed.href;
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
