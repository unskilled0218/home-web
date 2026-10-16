export async function requestDashboardJson(url, { fetchImpl = fetch, signal, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 10000, maxBytes = 65536, method = 'GET', body } = {}) {
  const controller = new AbortController(); let response;
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const deadline = schedule(abort, timeoutMs);
  const interrupted = new Promise((_resolve, reject) => {
    const fail = () => reject(new Error('Dashboard request timed out or was canceled.'));
    controller.signal.addEventListener('abort', fail, { once: true }); if (controller.signal.aborted) fail();
  });
  try {
    return await Promise.race([interrupted, (async () => {
      if (controller.signal.aborted) throw new Error('Canceled request.');
      response = await fetchImpl(url, { method, signal: controller.signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('Canceled request.'); }
      if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Dashboard response is too large.');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      const stop = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', stop, { once: true });
      let data;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (controller.signal.aborted) throw new Error('Canceled body.'); if (done) break;
          size += value.byteLength; if (size > maxBytes) throw new Error('Dashboard response is too large.'); if (value.byteLength) chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } finally { controller.signal.removeEventListener('abort', stop); void reader.cancel().catch(() => {}); }
      if (!response.ok) throw Object.assign(new Error(data?.error || 'Dashboard request failed.'), { status: response.status, data });
      return data;
    })()]);
  } catch (error) { controller.abort(); if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {}); throw error; }
  finally { cancel(deadline); signal?.removeEventListener('abort', abort); }
}
