import { CATEGORY_IDS, settingsCategory } from './dashboard-settings-categories.js';

// One control per policy category; neither labels nor DOM position decide ownership.
export function createCategoryControls({ document, onChange }) {
  const controls = new Map();
  for (const id of CATEGORY_IDS) {
    const panel = document.getElementById(`settings-panel-${id}`); const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = `${settingsCategory(id).label} scope`;
    const label = document.createElement('label'); label.textContent = 'Use settings for';
    const select = document.createElement('select'); select.id = `settings-scope-${id}`; select.setAttribute('aria-label', `${settingsCategory(id).label} settings scope`);
    for (const [value, text] of [['local', 'Local — this browser'], ['global', 'Global — shared category']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
    const status = document.createElement('p'); status.id = `scope-status-${id}`; status.setAttribute('role', 'status');
    label.append(select); fieldset.append(legend, label, status); panel.insertBefore(fieldset, panel.querySelector('h3').nextSibling);
    select.addEventListener('change', () => onChange(id, select.value)); controls.set(id, { select, status });
  }
  return {
    update(id, state) { const { select, status } = controls.get(id); select.value = state.mode; select.disabled = state.pending || state.mutating; status.textContent = state.mode === 'local' ? 'Local settings apply to this browser profile only.' : 'Global settings are shared with browsers using Global for this category.'; }
  };
}
