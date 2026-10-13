// Shared request ownership for the two dialog-only configuration screens.
export function createConfigurationController({ url, initial, decode, onChange = () => {}, fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 12000 }) {
  let value = initial; let discovered = false; let error = ''; let generation = 0;
  let read; let mutation; let paused = true; let disposed = false;
  const requests = new Set();
  const state = () => ({ ...value, discovered, error, loading: Boolean(read), mutationPending: Boolean(mutation) });
  const emit = () => { if (!disposed) onChange(state()); };
  function invalidateReads() {
    generation++;
    for (const request of requests) if (!request.mutation) request.controller.abort();
    read = undefined;
  }
  async function api(path, method, body, isMutation) {
    const controller = new AbortController(); const request = { controller, mutation: isMutation }; requests.add(request);
    const deadline = schedule(() => controller.abort(), timeoutMs);
    let response;
    try {
      const interrupted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error(isMutation ? 'Request timed out or was canceled. Its outcome is uncertain; check saved settings before retrying.' : 'Saved settings request timed out or was canceled.')), { once: true }));
      return await Promise.race([(async () => {
        response = await fetchImpl(path, { method, credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
        if (controller.signal.aborted) throw new Error('Saved settings request canceled.');
        if (response.ok && response.status === 204) return null;
        const data = await response.json();
        if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error.slice(0, 300) : 'Saved settings request failed.'), { status: response.status });
        return data;
      })(), interrupted]);
    } catch (failure) {
      controller.abort();
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      if (failure.status || controller.signal.aborted && failure.message.includes('outcome is uncertain')) throw failure;
      throw new Error(isMutation ? 'Settings request failed. Check saved settings before retrying.' : 'Saved settings are unavailable. Retrying while Settings is open.');
    } finally { cancel(deadline); requests.delete(request); }
  }
  function refresh() {
    if (paused || disposed) return Promise.resolve();
    if (mutation) return Promise.resolve();
    if (read) return read.promise;
    const owner = { generation, promise: null }; read = owner;
    owner.promise = (async () => {
      try {
        const next = decode(await api(url, 'GET', undefined, false));
        if (read === owner && generation === owner.generation && !disposed && !paused) { value = next; discovered = true; error = ''; }
      } catch (failure) { if (read === owner && !disposed && !paused) error = failure.message; }
      finally { if (read === owner) { read = undefined; emit(); } }
    })();
    emit(); return owner.promise;
  }
  return {
    getState: state, refresh,
    setPaused(next) { if (paused === next || disposed) return; paused = next; if (next) { invalidateReads(); emit(); } else void refresh(); },
    async mutate(path, method, body, adopt) {
      if (mutation || disposed) throw new Error('A settings action is already pending.');
      invalidateReads(); const owner = {}; mutation = owner; error = ''; emit();
      try {
        const data = await api(path, method, body, true);
        if (!disposed && mutation === owner) { value = adopt(data, value); discovered = true; error = ''; emit(); }
      } finally {
        if (mutation === owner) { mutation = undefined; emit(); if (!paused && !disposed) void refresh(); }
      }
    },
    dispose() { disposed = true; paused = true; invalidateReads(); for (const request of requests) request.controller.abort(); }
  };
}
