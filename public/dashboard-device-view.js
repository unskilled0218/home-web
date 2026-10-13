export function formatDeviceReading(reading) {
  return reading.status === 'unknown' ? 'Unknown' : reading.status === 'unavailable' ? 'Unavailable' : `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}`;
}

export function createDashboardDeviceView({ document, wake }) {
  const $ = (id) => document.getElementById(id); const rows = new Map(); const haRows = new Map();
  function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
  function renderHomeAssistant(state) {
    const { homeAssistant: connection, snapshot, selections } = state;
    const selected = new Set(selections); const devices = snapshot.devices.filter((device) => selected.has(device.selectionId));
    const list = $('dashboard-ha-devices'); const retained = new Set();
    for (const [index, device] of devices.entries()) {
      const signature = JSON.stringify(device); let row = haRows.get(device.selectionId);
      if (!row) { row = { node: document.createElement('li'), signature: '' }; haRows.set(device.selectionId, row); }
      if (row.signature !== signature) {
        row.node.replaceChildren(text('strong', device.name));
        if (device.disabled) row.node.append(text('p', 'Device disabled.'));
        else if (!device.measurements.length) row.node.append(text('p', 'No supported sensor readings.'));
        else { const readings = document.createElement('ul'); for (const reading of device.measurements) readings.append(text('li', `${reading.name}: ${formatDeviceReading(reading)}`)); row.node.append(readings); }
        row.signature = signature;
      }
      retained.add(device.selectionId); if (list.children[index] !== row.node) list.insertBefore(row.node, list.children[index] ?? null);
    }
    for (const [id, row] of haRows) if (!retained.has(id)) { row.node.remove(); haRows.delete(id); }
    const missing = selections.length - devices.length;
    $('dashboard-ha-status').textContent = !connection.discovered ? 'Loading saved Home Assistant connection…' : connection.needsReauthentication ? 'Home Assistant needs re-authentication. Open Settings.' : !connection.configured ? 'Connect Home Assistant in Settings.' : !selections.length ? 'Select Home Assistant devices in Settings.' : snapshot.error ? `${snapshot.error}${snapshot.discovered ? ' Showing a stale snapshot.' : ''}` : !snapshot.discovered ? 'Loading device readings…' : missing ? `${missing} selected device${missing === 1 ? ' is' : 's are'} missing from this connection.` : '';
    if (connection.error) $('dashboard-ha-status').textContent += ` ${connection.error}`;
    const updated = $('dashboard-ha-updated'); updated.hidden = snapshot.fetchedAt === null;
    updated.textContent = updated.hidden ? '' : `Snapshot fetched ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`;
    if (updated.hidden) updated.removeAttribute('datetime'); else updated.dateTime = new Date(snapshot.fetchedAt).toISOString();
  }
  function renderWol(state) {
    const list = $('dashboard-wol-devices'); const retained = new Set();
    for (const device of state.wol.devices) {
      let row = rows.get(device.id);
      if (!row) {
        const node = document.createElement('li'); const name = document.createElement('span'); const button = text('button', 'Wake'); button.type = 'button';
        button.addEventListener('click', () => { void wake(device.id); }); node.append(name, button); row = { node, name, button }; rows.set(device.id, row); list.append(node);
      }
      retained.add(device.id); row.name.textContent = device.name; row.button.setAttribute('aria-label', `Wake ${device.name}`); row.button.disabled = state.pendingIds.includes(device.id);
    }
    for (const [id, row] of rows) if (!retained.has(id)) { if (row.node.contains(document.activeElement)) $('dashboard-wol-status').focus(); row.node.remove(); rows.delete(id); }
    $('dashboard-wol-status').textContent = state.wol.error ? `${state.wol.error}${state.wol.discovered ? ' Showing the last confirmed device list.' : ''}` : !state.wol.discovered ? 'Loading saved devices…' : !state.wol.devices.length ? 'Add Wake-on-LAN devices in Settings.' : '';
    $('dashboard-wol-action-status').textContent = state.actionMessage;
  }
  return { render(state) { renderHomeAssistant(state); renderWol(state); } };
}
