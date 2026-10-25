import { parseSettingsJson, validateSettingsTransfer, MAX_SETTINGS_TRANSFER_BYTES } from './dashboard-settings-data.js';

export function createSettingsTransferControls({ document, window, coordinator, canImport }) {
  const get = id => document.getElementById(id); const events = new AbortController(); const options = { signal: events.signal };
  let selected; let generation = 0; let source; let busy = false; let download;
  const status = text => { get('settings-transfer-status').textContent = text; };
  function rebase() {
    if (!selected) return;
    const state = coordinator.getTransferState(); selected = { ...selected, token: state.saveToken, weatherRevision: state.snapshot.integrations.weather?.revision, preferencesRevision: state.snapshot.revision };
  }
  function update() {
    const state = coordinator.getTransferState();
    if (source !== state.source) { source = state.source; generation++; selected = undefined; get('global-settings-file').value = ''; status(''); if (download) { window.URL.revokeObjectURL(download); download = undefined; } }
    get('import-global-settings').disabled = busy || state.mode !== 'global' || state.scopeError || !state.confirmed || state.pending || state.mutating || !selected || !Number.isSafeInteger(selected.weatherRevision) || !canImport();
    get('export-global-settings').disabled = busy;
  }
  get('global-settings-file').addEventListener('change', async () => {
    const owner = ++generation; const file = get('global-settings-file').files[0]; selected = undefined; update(); if (!file) return;
    try {
      if (file.size > MAX_SETTINGS_TRANSFER_BYTES) throw new Error('Settings file exceeds 128 KiB.');
      const settings = validateSettingsTransfer(parseSettingsJson(await file.text()));
      if (owner !== generation) return;
      selected = { settings }; rebase(); status('Global settings file ready. Import replaces all Global category values, not Local values or category choices.');
    } catch (error) { if (owner === generation) status(error.message); }
    finally { update(); }
  }, options);
  get('export-global-settings').addEventListener('click', async () => {
    const owner = generation; busy = true; update();
    try {
      const settings = await coordinator.exportGlobal(); if (owner !== generation) return;
      download = window.URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = download; link.download = 'dashboard-global-settings.json'; document.body.append(link); link.click(); link.remove();
      window.URL.revokeObjectURL(download); download = undefined; status('Global settings exported.');
    } catch (error) { if (owner === generation) status(error.message); }
    finally { busy = false; update(); }
  }, options);
  get('import-global-settings').addEventListener('click', async () => {
    if (!selected || !canImport() || busy) return; const owner = generation; busy = true; update();
    try {
      await coordinator.importGlobal(selected.settings, { preferencesRevision: selected.preferencesRevision, weatherRevision: selected.weatherRevision }, selected.token);
      if (owner === generation) { status('Global settings imported. Local preferences and category choices were not changed. Local followers continue tracking the shared slideshow.'); selected = undefined; get('global-settings-file').value = ''; }
    } catch (error) { if (owner === generation) status(error.message); }
    finally { busy = false; update(); }
  }, options);
  return { update, rebase, dispose() { generation++; events.abort(); if (download) window.URL.revokeObjectURL(download); } };
}
