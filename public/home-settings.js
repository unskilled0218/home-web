import { normalizeHomeSettings } from './home-layout.js';

export function createHomeSettingsController({ fetchImpl = fetch, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout, onChange = () => {} } = {}) {
  let saved = null; let draft = null; let error = ''; let conflict = false; let visible = true; let disposed = false; let pending = null; let saving = false; let timer; let generation = 0; let abort;
  const state = () => ({ settings: draft ?? saved, saved, editing: Boolean(draft), saving, error, conflict });
  const emit = () => onChange(state());
  function schedule() { clearTimeoutImpl(timer); if (visible && !disposed) timer = setTimeoutImpl(() => { void load(); }, 30000); }
  async function request(options) {
    const response = await fetchImpl('/api/home/settings', { ...options, signal: AbortSignal.any([options?.signal, AbortSignal.timeout(15000)].filter(Boolean)) });
    const data = await response.json();
    if (!response.ok) { const failure = new Error(data.error || 'Home settings request failed.'); failure.status = response.status; throw failure; }
    return normalizeHomeSettings(data);
  }
  function load() {
    if (disposed || saving) return Promise.resolve();
    if (pending) return pending;
    const current = ++generation; abort = new AbortController();
    pending = (async () => {
      try {
        const remote = await request({ signal: abort.signal });
        if (current !== generation || disposed) return;
        if (draft && remote.revision !== saved.revision) conflict = true;
        else if (!draft && (!saved || remote.revision >= saved.revision)) saved = remote;
        error = '';
      } catch (failure) { if (current === generation && failure.name !== 'AbortError') error = failure.message; }
      finally { if (current === generation) { pending = null; schedule(); emit(); } }
    })();
    return pending;
  }
  return {
    getState: state, load,
    begin() { if (!saved || disposed || saving) return; draft ??= structuredClone(saved); emit(); },
    update(change) {
      if (!saved || saving || disposed) return;
      draft = normalizeHomeSettings(change(structuredClone(draft ?? saved))); emit();
    },
    cancel() { if (saving) return; draft = null; conflict = false; error = ''; emit(); void load(); },
    async save() {
      if (!draft || saving || disposed) return false;
      if (conflict) { error = 'Another device saved changes. Cancel to reload, then reapply your edits.'; emit(); return false; }
      generation++; abort?.abort(); pending = null; clearTimeoutImpl(timer); saving = true; error = ''; emit();
      try {
        saved = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        draft = null; conflict = false; return true;
      } catch (failure) { error = failure.message; conflict = failure.status === 409; return false; }
      finally { saving = false; if (!disposed) { schedule(); emit(); } }
    },
    setVisible(value) {
      visible = Boolean(value); clearTimeoutImpl(timer);
      if (!visible) { generation++; abort?.abort(); pending = null; }
      else void load();
    },
    dispose() { disposed = true; generation++; abort?.abort(); clearTimeoutImpl(timer); }
  };
}
