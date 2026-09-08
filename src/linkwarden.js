const MAX_RESPONSE_BYTES = 1_000_000;

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

export function createLinkwardenClient({ fetchImpl = fetch, timeoutMs = 8_000, cacheSeconds = 60 } = {}) {
  let cache = null;
  let inFlight = null;
  const request = async (url, accessToken) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: controller.signal });
      return boundedJson(response);
    } finally { clearTimeout(timer); }
  };
  const refresh = async ({ baseUrl, collectionId, accessToken }) => {
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
    cache = { key: `${baseUrl}:${collectionId}`, bookmarks, fetchedAt: Date.now() };
    return { bookmarks, stale: false };
  };
  return {
    clearCache: () => { cache = null; },
    async listCollections({ baseUrl, accessToken }) {
      const payload = await request(new URL('/api/v1/collections', baseUrl).href, accessToken);
      const entries = payload?.response ?? payload?.data ?? [];
      if (!Array.isArray(entries)) throw new Error('Linkwarden returned an invalid collection list.');
      return entries.flatMap((collection) => {
        const id = Number(collection?.id);
        const name = typeof collection?.name === 'string' ? collection.name.trim().slice(0, 300) : '';
        return Number.isSafeInteger(id) && id > 0 && name ? [{ id, name }] : [];
      });
    },
    async getBookmarks(settings, { force = false } = {}) {
      const key = `${settings.baseUrl}:${settings.collectionId}`;
      if (!force && cache?.key === key && Date.now() - cache.fetchedAt < cacheSeconds * 1_000) return { bookmarks: cache.bookmarks, stale: false };
      if (inFlight) {
        try { await inFlight.promise; } catch { /* The matching stale-cache fallback is handled below. */ }
        if (cache?.key === key) return { bookmarks: cache.bookmarks, stale: false };
        return this.getBookmarks(settings, { force: true });
      }
      const promise = refresh(settings);
      inFlight = { key, promise };
      try { return await promise; } catch { if (cache?.key === key) return { bookmarks: cache.bookmarks, stale: true }; throw new Error('Linkwarden is currently unavailable.'); } finally { if (inFlight?.promise === promise) inFlight = null; }
    },
    test: (settings) => refresh(settings)
  };
}
