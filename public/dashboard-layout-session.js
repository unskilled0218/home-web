import { normalizeWidgetLayout, initialWidgetProfile, editWidget, changeWidgetLayer } from './dashboard-layout.js';

// Local layout ownership only. The coordinator supplies complete confirmed preferences and saves.
export function createLayoutSession() {
  let baseline; let draft; let revision; let source; let mode; let selected = 'time'; let automatic = {};
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    load(state, profile, widget = selected) { baseline = structuredClone(state.snapshot.preferences); draft = normalizeWidgetLayout(baseline.widgetLayout); automatic = {}; revision = state.confirmed ? state.saveToken ?? state.snapshot.revision : null; source = state.source; mode = profile; selected = widget; },
    get mode() { return mode; }, set mode(value) { mode = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get draft() { return draft; }, get revision() { return revision; },
    get source() { return source; },
    preview(profile, value) { if (!draft[profile]) automatic[profile] = value ? structuredClone(value) : undefined; },
    effective() { return draft[mode] || automatic[mode] || initialWidgetProfile(mode, baseline.position); },
    changed() { return !equal(draft, baseline.widgetLayout); },
    edit(pixels, reference, original = this.effective()) { const next = editWidget(original, selected, pixels, reference); if (!equal(next, original)) draft[mode] = next; },
    layer(action, widget = selected, eligibleIds) { const original = this.effective(); const next = changeWidgetLayer(original, widget, action, eligibleIds); if (next !== original) draft[mode] = next; },
    arrange(value) { draft[mode] = value === 'custom' ? this.effective() : null; },
    restore(profile) { draft[mode] = profile; },
    payload() { return { preferences: { widgetLayout: normalizeWidgetLayout(draft) }, revision }; }
  };
}
