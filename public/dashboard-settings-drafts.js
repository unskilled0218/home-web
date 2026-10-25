import { CATEGORY_IDS } from './dashboard-settings-categories.js';

// Draft baselines never rebase implicitly after a save to the same backing store.
export function createCategoryDrafts() {
  const drafts = new Map(); let session = 0;
  return {
    get: id => drafts.get(id),
    load(id, state) { const draft = { source: state.source, token: state.confirmed ? state.saveToken : null, baseline: structuredClone(state.snapshot.preferences), dirty: false, message: '', session }; drafts.set(id, draft); return draft; },
    dirty(id) { const draft = drafts.get(id); if (draft) { draft.dirty = true; draft.message = ''; } },
    anyDirty: () => [...drafts.values()].some(draft => draft.dirty),
    stale(id, state) { const draft = drafts.get(id); return Boolean(draft && draft.source !== state.source); },
    observe(id, state, open) { if (!open || !drafts.get(id)?.dirty) return this.load(id, state); return null; },
    clear() { session++; drafts.clear(); },
    ids: CATEGORY_IDS
  };
}
