export function showDialogError(element, message = '') {
  element.textContent = message;
}

export function updateCollectionSelection(root, token) {
  for (const element of root.querySelectorAll('[data-collection-token]')) {
    const selected = element.dataset.collectionToken === token;
    element.classList.toggle('selected', selected);
    element.setAttribute('aria-current', selected ? 'true' : 'false');
  }
}

export function restoreCollectionFocus(root, key) {
  if (!key) return false;
  const target = [...root.querySelectorAll('[data-collection-key]')].find((element) => element.dataset.collectionKey === key);
  target?.focus();
  return Boolean(target);
}

export function flattenCollections(collections) {
  return collections.flatMap((collection) => [collection, ...flattenCollections(collection.children)]);
}

export function filterHomeDevices(devices, term) {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return devices;
  return devices.filter((device) => [device.name, device.area, device.manufacturer, device.model, ...(device.measurements ?? []).flatMap((measurement) => [measurement.name, measurement.deviceClass, measurement.unit]), ...(device.controls ?? []).map((control) => control.name)].filter(Boolean).join(' ').toLowerCase().includes(normalized));
}

export function groupHomeDevices(devices) {
  return Map.groupBy(devices, (device) => device.area || 'Unassigned');
}

export function homeControlPresentation(control, pending = false) {
  const action = control.state === 'on' ? 'turn_off' : 'turn_on';
  return { action, disabled: !control.available || pending, pressed: control.state === 'on', text: pending ? 'Working…' : action === 'turn_on' ? 'Turn on' : 'Turn off' };
}

export function homeMeasurementPresentation(measurement) {
  if (measurement.status === 'unavailable') return { text: 'Unavailable', unit: '', unavailable: true };
  if (measurement.status === 'unknown') return { text: 'Unknown', unit: '', unavailable: true };
  return { text: measurement.value, unit: measurement.unit ?? '', unavailable: false };
}

export function isLatestRequest(current, request) {
  return current === request;
}
