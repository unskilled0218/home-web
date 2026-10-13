import { MAX_HOME_ASSISTANT_SELECTIONS, normalizeDeviceSelections } from './dashboard-helpers.js';

export function createDeviceSelection({ document, root, status, onChange = () => {} }) {
  const rows = new Map(); let draft = new Set(); let devices = []; let saving = false; let message = ''; let source;
  function render() {
    const current = new Map(devices.map((device) => [device.selectionId, device]));
    const labels = new Map();
    const labelFor = (device) => `${device.name}${device.area ? ` · ${device.area}` : ''}${device.model ? ` · ${device.model}` : ''}${device.disabled ? ' (disabled)' : ''}`;
    for (const device of devices) { const label = labelFor(device); labels.set(label, (labels.get(label) ?? 0) + 1); }
    const ids = [...new Set([...current.keys(), ...draft])]; const retained = new Set(ids);
    for (const [position, id] of ids.entries()) {
      let row = rows.get(id);
      if (!row) {
        const node = document.createElement('li'); const label = document.createElement('label'); label.className = 'toggle';
        const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('form', 'preferences');
        const title = document.createElement('span'); label.append(input, title); node.append(label);
        input.addEventListener('change', () => {
          if (saving) { render(); return; }
          if (input.checked && draft.size >= MAX_HOME_ASSISTANT_SELECTIONS) { input.checked = false; message = 'Select at most 256 devices. Remove a selection before adding another.'; }
          else { if (input.checked) draft.add(id); else draft.delete(id); message = ''; onChange(); }
          render();
        });
        row = { node, input, title }; rows.set(id, row); root.append(node);
      }
      const device = current.get(id); const index = position + 1;
      row.title.textContent = device ? `${labelFor(device)}${labels.get(labelFor(device)) > 1 ? ` (device ${index})` : ''}` : `Missing selected device ${index} — not available from the current connection`;
      row.input.checked = draft.has(id); row.input.disabled = saving;
    }
    for (const [id, row] of rows) if (!retained.has(id)) { if (row.node.contains(document.activeElement)) status.focus(); row.node.remove(); rows.delete(id); }
    status.textContent = message || (!source?.homeAssistant.discovered ? 'Loading saved connection…' : source.homeAssistant.needsReauthentication ? 'Reconnect Home Assistant to list devices.' : !source.homeAssistant.configured ? 'Connect Home Assistant to choose devices.' : source.snapshot.error ? `${source.snapshot.error} Existing selections are kept.` : !source.snapshot.discovered ? 'Loading available devices…' : !devices.length ? 'No devices returned. Existing selections are kept.' : 'Select up to 256 devices, then Save preferences. Missing selections remain saved until you remove them.');
  }
  return {
    getDraft: () => [...draft].sort(),
    setDraft(value) { draft = new Set(normalizeDeviceSelections(value)); message = ''; render(); },
    setSaving(next) { saving = next; render(); },
    update(next) { source = next; devices = next.snapshot.devices; render(); }
  };
}
