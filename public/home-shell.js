export function createHomeShell({ document = globalThis.document, settings, prepareSettings, cancelGesture, now = Date.now }) {
  const $ = (id) => document.getElementById(id); const dialog = $('home-settings-dialog');
  let lastFullscreenChange = -Infinity; let pendingFullscreen = false; let wasFullscreen = Boolean(document.fullscreenElement);
  function fullscreenState() {
    $('home-fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : document.fullscreenEnabled ? 'Enter fullscreen' : 'Fullscreen unavailable';
    $('home-fullscreen').disabled = pendingFullscreen || (!document.fullscreenElement && !document.fullscreenEnabled);
  }
  function fullscreenChange() { lastFullscreenChange = now(); wasFullscreen = Boolean(document.fullscreenElement); cancelGesture(); fullscreenState(); }
  async function toggleFullscreen() {
    cancelGesture(); pendingFullscreen = true; fullscreenState(); $('home-fullscreen-status').textContent = '';
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { $('home-fullscreen-status').textContent = 'Fullscreen could not be enabled or exited in this browser.'; }
    finally { pendingFullscreen = false; fullscreenState(); }
  }
  function open() { cancelGesture(); if (settings.getState().settings) prepareSettings(); dialog.showModal(); }
  function edit() { if (!settings.getState().settings) return; settings.begin(); dialog.close(); }
  async function save() { if (await settings.save()) dialog.close(); }
  function cancel() { cancelGesture(); settings.cancel(); dialog.close(); }
  function escape(event) {
    if (event.key !== 'Escape' || event.repeat || document.fullscreenElement || wasFullscreen || now() - lastFullscreenChange < 500 || document.querySelector('dialog[open]') || !settings.getState().editing) return;
    cancelGesture(); settings.cancel(); $('home-settings-open').focus();
  }
  $('home-settings-open').addEventListener('click', open);
  $('home-settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => $('home-settings-open').focus());
  $('home-edit').addEventListener('click', edit);
  $('home-dialog-save').addEventListener('click', save);
  $('home-dialog-cancel').addEventListener('click', cancel);
  $('home-retry').addEventListener('click', () => settings.load());
  $('home-fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', fullscreenChange);
  document.addEventListener('keydown', escape);
  fullscreenState();
  return { dispose() { document.removeEventListener('fullscreenchange', fullscreenChange); document.removeEventListener('keydown', escape); } };
}
