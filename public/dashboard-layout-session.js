import { normalizeWidgetLayout, initialWidgetProfile, editWidget, changeWidgetLayer } from './dashboard-layout.js';

// Local layout ownership only. The coordinator supplies complete confirmed preferences and saves.
export function createLayoutSession() {
  let baseline; let draft; let revision; let mode; let selected = 'time';
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    load(state, profile, widget = selected) { baseline = structuredClone(state.snapshot.preferences); draft = normalizeWidgetLayout(baseline.widgetLayout); revision = state.confirmed ? state.saveToken ?? state.snapshot.revision : null; mode = profile; selected = widget; },
    get mode() { return mode; }, set mode(value) { mode = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get draft() { return draft; }, get revision() { return revision; },
    effective() { return draft[mode] || initialWidgetProfile(mode, baseline.position); },
    changed() { return !equal(draft, baseline.widgetLayout); },
    edit(pixels, reference, original = this.effective()) { const next = editWidget(original, selected, pixels, reference); if (!equal(next, original)) draft[mode] = next; },
    layer(action, widget = selected) { const original = this.effective(); const next = changeWidgetLayer(original, widget, action); if (next !== original) draft[mode] = next; },
    arrange(value) { draft[mode] = value === 'custom' ? this.effective() : null; },
    restore(profile) { draft[mode] = profile; },
    payload() { return { preferences: { ...structuredClone(baseline), widgetLayout: normalizeWidgetLayout(draft) }, revision }; }
  };
}
