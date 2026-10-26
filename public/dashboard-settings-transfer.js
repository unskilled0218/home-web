import { parseSettingsJson, validateSettingsTransfer, MAX_SETTINGS_TRANSFER_BYTES } from './dashboard-settings-data.js';

export function createSettingsTransferControls({ document, window, coordinator, canImport }) {
  const get = id => document.getElementById(id); const events = new AbortController(); const options = { signal: events.signal };
  let selected; let generation = 0; let busy = false; let download; let disposed = false;
  const status = text => { get('settings-transfer-status').textContent = text; };
  async function prepare(owner) {
    try {
      const baseline = await coordinator.prepareTransfer();
      if (disposed || owner !== generation) return;
      selected = { ...selected, token: baseline.saveToken, weatherRevision: baseline.snapshot.integrations.weather.revision, preferencesRevision: baseline.snapshot.revision };
      status('Global settings file ready. Import replaces all Global category values, not Local values or category choices.');
    } catch (error) { if (!disposed && owner === generation) status(error.message); }
    finally { if (!disposed && owner === generation) update(); }
  }
  async function rebase() {
    if (!selected) return;
    selected = { settings: selected.settings }; const owner = ++generation; update(); await prepare(owner);
  }
  function update() {
    const state = coordinator.getTransferState();
    get('import-global-settings').disabled = busy || state.preparing || state.scopeError || !state.confirmed || state.pending || state.mutating || !selected?.token || selected.token !== state.saveToken || !Number.isSafeInteger(selected.weatherRevision) || !canImport();
    get('export-global-settings').disabled = busy;
    get('global-settings-file').disabled = busy;
  }
  get('global-settings-file').addEventListener('change', async () => {
    const owner = ++generation; const file = get('global-settings-file').files[0]; selected = undefined; coordinator.cancelTransferPreparation(); status(''); update(); if (!file) return;
    try {
      if (file.size > MAX_SETTINGS_TRANSFER_BYTES) throw new Error('Settings file exceeds 128 KiB.');
      const settings = validateSettingsTransfer(parseSettingsJson(await file.text()));
      if (owner !== generation) return;
      selected = { settings }; await prepare(owner);
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
    if (!selected?.token || !canImport() || busy || get('import-global-settings').disabled) return; const owner = generation; busy = true; update();
    try {
      await coordinator.importGlobal(selected.settings, { preferencesRevision: selected.preferencesRevision, weatherRevision: selected.weatherRevision }, selected.token);
      if (owner === generation) { status('Global settings imported. Local preferences and category choices were not changed. Local followers continue tracking the shared slideshow.'); selected = undefined; get('global-settings-file').value = ''; }
    } catch (error) { if (owner === generation) status(error.message); }
    finally { busy = false; update(); }
  }, options);
  return { update, rebase, dispose() { disposed = true; generation++; coordinator.cancelTransferPreparation(); events.abort(); if (download) window.URL.revokeObjectURL(download); } };
}
