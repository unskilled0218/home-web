const MAX_RESPONSE_BYTES = 1_000_000;

export function normalizeLinkwardenConfig(input, existing = null) {
  let url;
  try { url = new URL(typeof input.url === 'string' ? input.url.trim() : ''); } catch { throw new Error('Linkwarden URL must be an absolute http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Linkwarden URL must be an absolute http or https URL.');
  const collectionId = Number(input.collectionId);
  if (!Number.isSafeInteger(collectionId) || collectionId < 1) throw new Error('Collection ID must be a positive integer.');
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!apiKey && !existing) throw new Error('An API key is required to connect Linkwarden.');
  if (apiKey.length > 2_000) throw new Error('API key is too long.');
  return { baseUrl: url.href.replace(/\/$/, ''), collectionId, apiKey: apiKey || null };
}

function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function normalizeBookmarks(payload) {
  const entries = Array.isArray(payload) ? payload : payload?.data ?? payload?.bookmarks ?? [];
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
  const refresh = async ({ baseUrl, collectionId, apiKey }) => {
    const origin = new URL(baseUrl).origin;
    let next = new URL(`/api/v1/collections/${collectionId}/bookmarks`, baseUrl).href;
    const bookmarks = [];
    while (next) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let payload;
      try {
        const response = await fetchImpl(next, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: controller.signal });
        payload = await boundedJson(response);
      } finally { clearTimeout(timer); }
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
