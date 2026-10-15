import { MOBILE_MEDIA_QUERY, PREFERENCE_KEYS, clockText, normalizeDashboardPreferences, preferencesEqual, resolveDisplayPreferences, sampleHours, temperatureRange, weatherDescription, weatherIconFile } from './dashboard-helpers.js';
import { createWeatherController, searchLocations } from './dashboard-weather.js';
import { createPhotoController } from './dashboard-photos.js';
import { createCalendarController, formatCalendarEvent } from './dashboard-calendar.js';
import { createSettingsTabs } from './dashboard-settings.js';
import { formatWeatherUpdated } from './weather-data.js';
import { createBookmarkController } from './dashboard-bookmarks.js';
import { createBookmarkList } from './dashboard-bookmark-list.js';
import { createBookmarkSelection } from './dashboard-bookmark-selection.js';
import { safeBookmarkUrl } from './bookmark-data.js';
import { createSettingsSync } from './dashboard-settings-sync.js';
import { createIntegrationSettings } from './dashboard-integration-settings.js';
import { createDashboardDevices } from './dashboard-devices.js';
import { createDeviceSelection } from './dashboard-device-selection.js';
import { createDashboardDeviceView } from './dashboard-device-view.js';
import { dashboardDisplay, applyDashboardDisplay } from './dashboard-display.js';
import { createDashboardLayoutView } from './dashboard-layout-view.js';
import { createDashboardLayoutEditor } from './dashboard-layout-editor.js';

const $ = (id) => document.getElementById(id);
const currentWeatherSubValues = document.createElement('div');
currentWeatherSubValues.id = 'current-weather-subvalues';

let storage;
try { storage = window.localStorage; } catch { /* Defaults work when browser storage is blocked. */ }
let settings = { ...normalizeDashboardPreferences(), location: null };
let servicesStarted = false; let draftRevision = null; let draftDirty = false; let preferenceMessage = '';
let clockTimer; let searchController; let searchGeneration = 0; let weatherState = {}; let calendarState = {}; let animations = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobileViewport = matchMedia(MOBILE_MEDIA_QUERY);
let draftBaseline; let settingsSession = 0; let layoutEditor;
const preferences = $('preferences');
const dialog = $('settings-dialog');
const layoutView = createDashboardLayoutView({ document, window, onMeasure: () => layoutEditor?.refreshSurface() });
layoutEditor = createDashboardLayoutEditor({ document, window, surface: layoutView.surface, position: () => preferences.elements.namedItem('position').value, onChange: () => updateDraftDirty() });
const settingsTabs = createSettingsTabs(dialog, { onSelect: (id) => { deviceIntegrations.setPickerOpen(dialog.open && id === 'settings-tab-home-assistant'); bookmarks.setPickerOpen(dialog.open && id === 'settings-tab-bookmarks'); } });
const deviceView = createDashboardDeviceView({ document, wake: (id) => deviceIntegrations.wake(id) });
const deviceSelection = createDeviceSelection({ document, root: $('home-assistant-device-picker'), status: $('home-assistant-selection-status'), onChange: () => { draftDirty = true; } });
const deviceIntegrations = createDashboardDevices({ onChange: (state) => { deviceView.render(state); deviceSelection.update(state); } });
const integrationSettings = createIntegrationSettings({ document, homeAssistant: deviceIntegrations.homeAssistant, wol: deviceIntegrations.wol });
const bookmarkList = createBookmarkList({ root: $('bookmark-tree'), status: $('bookmarks-status'), onRetry: (id) => bookmarks.retryFolder(id) });
const bookmarkSelection = createBookmarkSelection({ document, root: $('bookmark-link-picker'), foldersRoot: $('bookmark-picker-folders'), status: $('bookmark-selection-status'), selectNone: $('bookmark-select-none'), reload: $('bookmark-reload-folders'), onChange: () => { draftDirty = true; }, onToggle: (id, open) => bookmarks.setPickerFolderOpen(id, open), onReload: () => bookmarks.reloadPickerFolders() });
const bookmarks = createBookmarkController({ onChange(state) {
  bookmarkList.render(state.dashboard); bookmarkSelection.update(state);
  const link = $('open-linkwarden'); const url = safeBookmarkUrl(state.baseUrl);
  link.hidden = !url; if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; } else link.removeAttribute('href');
  $('connect-linkwarden').disabled = state.mutationPending || (state.discovered && !state.encryptionReady);
  $('linkwarden-token').required = state.needsReauthentication || !state.accessTokenPresent;
  $('disconnect-linkwarden').disabled = state.mutationPending || (!state.configured && !state.accessTokenPresent);
} });

function fillForm() {
  for (const control of preferences.elements) {
    if (!(control.name in settings)) continue;
    if (control.type === 'checkbox') control.checked = settings[control.name];
    else control.value = settings[control.name];
  }
  deviceSelection.setDraft(settings.homeAssistantDeviceSelections);
  bookmarkSelection.setDraft(settings.bookmarkLinkSelections);
  layoutEditor.setDraft(settings.widgetLayout);
  draftBaseline = normalizeDashboardPreferences(settings);
}

function readPreferenceDraft() {
  const next = {};
  for (const control of preferences.elements) {
    if (!PREFERENCE_KEYS.includes(control.name)) continue;
    next[control.name] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? control.valueAsNumber : control.value;
  }
  next.homeAssistantDeviceSelections = deviceSelection.getDraft();
  next.bookmarkLinkSelections = bookmarkSelection.getDraft();
  next.widgetLayout = layoutEditor.getDraft();
  return normalizeDashboardPreferences(next);
}
function updateDraftDirty() {
  for (const control of preferences.elements) {
    if (!PREFERENCE_KEYS.includes(control.name)) continue;
    const value = control.type === 'checkbox' ? control.checked : control.type === 'number' ? control.valueAsNumber : control.value;
    if (!preferencesEqual(value, draftBaseline?.[control.name])) { draftDirty = true; return; }
  }
  try { draftDirty = !preferencesEqual(readPreferenceDraft(), draftBaseline); }
  catch { draftDirty = true; }
}

function updateClock() {
  const now = new Date(); const formatted = clockText(now, settings);
  $('date').textContent = formatted.date; $('time').textContent = formatted.time; $('time').dateTime = now.toISOString();
}

function startClock() { clearInterval(clockTimer); updateClock(); if (!document.hidden && resolveDisplayPreferences(settings, mobileViewport.matches).timeVisible) clockTimer = setInterval(updateClock, 1000); }
function element(tag, content, className) { const node = document.createElement(tag); node.textContent = content; if (className) node.className = className; return node; }
const reading = (value, unit = '') => value === null || value === undefined ? 'Unavailable' : `${value}${unit ? ` ${unit}` : ''}`;
function forecastItem({ code, day = 1, label, temperature }) {
  const item = document.createElement('li'); item.className = 'forecast-item';
  const icon = document.createElement('img'); icon.className = 'forecast-icon'; icon.alt = ''; icon.setAttribute('aria-hidden', 'true'); icon.src = `/weather-icons/${weatherIconFile(code, day)}`;
  item.append(icon, element('span', label, 'forecast-label'), element('strong', temperature, 'forecast-temperature'), element('span', weatherDescription(code, day), 'forecast-condition'));
  return item;
}

function renderWeather(state = weatherState) {
  weatherState = state;
  if (state.discovered) settings = { ...settings, location: state.location };
  $('current-location').textContent = state.serviceError ? (state.location ? `Current location: ${state.location.label} (server unavailable).` : 'Saved weather location unavailable.') : !state.discovered ? 'Loading saved weather location…' : state.location ? `Current location: ${state.location.label}` : 'No weather location saved.';
  for (const button of $('location-results').querySelectorAll('button')) button.disabled = Boolean(state.mutationPending) || !state.discovered;
  const forecast = state.forecast;
  $('weather-status').textContent = state.serviceError ? 'Weather server unavailable. Retrying automatically.' : !state.discovered ? 'Loading saved weather…' : !settings.location ? 'Choose a location in Settings to show weather.' : state.forecastError ? (forecast ? 'Forecast is stale; refresh failed. Retrying hourly.' : 'Forecast unavailable. Retrying hourly.') : state.loading ? 'Updating weather…' : !forecast ? 'Weather is not available yet.' : '';
  const updated = $('weather-updated');
  updated.hidden = !forecast || state.forecastUpdated === null || state.forecastUpdated === undefined;
  updated.textContent = updated.hidden ? '' : formatWeatherUpdated(state.forecastUpdated, settings);
  if (updated.hidden) updated.removeAttribute('datetime'); else updated.dateTime = new Date(state.forecastUpdated).toISOString();
  const icon = $('weather-icon');
  icon.hidden = true; icon.removeAttribute('src');
  $('current-weather-values').replaceChildren(); currentWeatherSubValues.replaceChildren(); $('hourly').replaceChildren(); $('daily').replaceChildren();
  $('forecast-details').hidden = !forecast;
  if (forecast) {
    const current = forecast.current; const units = forecast.units;
    icon.src = `/weather-icons/${weatherIconFile(current.weather_code, current.is_day)}`; icon.hidden = false;
    $('current-weather-values').append(element('strong', reading(current.temperature_2m, units.temperature_2m), 'temperature'), element('span', weatherDescription(current.weather_code, current.is_day), 'condition'));
    currentWeatherSubValues.append(element('span', `Wind ${reading(current.wind_speed_10m, units.wind_speed_10m)}`), element('span', `Humidity ${reading(current.relative_humidity_2m, units.relative_humidity_2m)}`), element('span', `Precipitation ${reading(current.precipitation, units.precipitation)}`));
    for (const hour of sampleHours(forecast.hourly)) {
      const label = new Intl.DateTimeFormat(undefined, { timeZone: settings.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: settings.hour12 }).format(new Date(hour.time * 1000));
      $('hourly').append(forecastItem({ code: hour.code, day: hour.day, label, temperature: reading(hour.temperature, forecast.hourlyUnit) }));
    }
    if (!$('hourly').children.length) $('hourly').append(element('li', 'Hourly forecast unavailable.'));
    for (const day of forecast.daily) {
      const label = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00Z`));
      $('daily').append(forecastItem({ code: day.code, label, temperature: temperatureRange(day.min, day.max, forecast.dailyUnit) }));
    }
    if (!$('daily').children.length) $('daily').append(element('li', 'Daily forecast unavailable.'));
  }
  currentWeatherSubValues.append(element('span', `${!settings.location ? '' : state.air ? `US AQI: ${state.air.aqi}${state.airError ? ' (stale; refresh failed)' : ''}` : state.airError ? 'Air quality unavailable.' : state.loading ? 'Loading air quality…' : ''}`));
  $('current-weather-values').append(currentWeatherSubValues);
}

const weather = createWeatherController({ onChange: renderWeather, autoStart: false });
function renderCalendar(state = calendarState) {
  calendarState = state;
  const list = $('calendar-events');
  list.replaceChildren();
  let status = '';
  if (state.needsReauthentication) status = 'Calendar needs re-authentication. Open Settings and enter the Baikal password.';
  else if (!state.configured) status = state.encryptionReady === false ? 'Calendar credential encryption is not configured on this server.' : 'Connect a Baikal calendar in Settings.';
  else if (state.loading && !state.events?.length) status = 'Loading upcoming events…';
  else if (state.error && state.events?.length) status = `${state.error} Showing the last successful calendar snapshot.`;
  else if (state.error) status = state.error;
  else if (state.stale) status = 'Showing stale calendar events; the latest refresh failed.';
  else if (!state.events?.length) status = 'No events in the next 14 days.';
  $('calendar-status').textContent = status;
  for (const event of state.events ?? []) {
    const formatted = formatCalendarEvent(event, settings);
    if (!formatted) continue;
    const item = document.createElement('li'); item.className = `calendar-event ${formatted.timing}`;
    const date = element('span', formatted.date, 'calendar-event-date');
    const title = element('strong', event.title, 'calendar-event-title');
    const time = element('span', formatted.timing === 'current' ? `Now · ${formatted.time}` : formatted.time, 'calendar-event-time');
    item.append(date, title, time);
    if (event.location) item.append(element('span', event.location, 'calendar-event-location'));
    list.append(item);
  }
}
const calendar = createCalendarController({ onChange: renderCalendar, autoStart: false });
function stopAnimations() { animations.forEach((animation) => animation.cancel()); animations = []; }
function applyVisibilityLayout() {
  const display = dashboardDisplay(settings, { mobile: mobileViewport.matches, fullscreen: Boolean(document.fullscreenElement), caption: Boolean($('photo-caption').textContent) });
  applyDashboardDisplay(document, display);
  layoutView.update({ layout: settings.widgetLayout, mobile: mobileViewport.matches, scale: settings.scale, display });
  return display;
}
function clearPhotos() { stopAnimations(); $('photos').replaceChildren(); $('photo-caption').textContent = ''; applyVisibilityLayout(); }
const photos = createPhotoController({
  clear: clearPhotos,
  report: (message) => { $('photo-status').textContent = message; },
  show(photo, options) {
    stopAnimations();
    const container = $('photos');
    while (container.children.length > 1) container.firstElementChild.remove();
    const previous = container.lastElementChild;
    const layer = document.createElement('div'); layer.className = 'photo-layer';
    if (options.background === 'blur') { const background = new Image(); background.alt = ''; background.src = photo.url; background.className = 'photo-blur'; background.style.filter = `blur(${options.blur}px)`; layer.append(background); }
    const image = new Image(); image.alt = ''; image.src = photo.url; layer.append(image); layer.style.opacity = options.opacity;
    container.append(layer);
    $('photo-caption').textContent = options.imageInfo ? photo.file.name : '';
    applyVisibilityLayout();
    if (previous && options.animation !== 'none' && options.duration > 0 && !reducedMotion.matches && layer.animate) {
      const frames = options.animation === 'slide' ? [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }] : [{ opacity: 0 }, { opacity: options.opacity }];
      const animation = layer.animate(frames, { duration: options.duration * 1000, easing: 'ease-in-out' });
      animations.push(animation);
      if (options.animation === 'fade') animations.push(previous.animate([{ opacity: Number(previous.style.opacity) }, { opacity: 0 }], { duration: options.duration * 1000, fill: 'forwards' }));
      animation.finished.then(() => { previous.remove(); }, () => {});
    } else previous?.remove();
  }
});

function applyPresentation() {
  const mobile = mobileViewport.matches;
  const display = resolveDisplayPreferences(settings, mobile);
  $('information').classList.toggle('right', display.position === 'right');
  $('information').style.setProperty('--scale', display.scale);
  $('clock').style.setProperty('--time-scale', display.timeScale);
  $('weather').style.setProperty('--weather-scale', display.weatherScale);
  $('calendar').style.setProperty('--calendar-scale', display.calendarScale);
  startClock();
  applyBookmarkPresentation();
}

function applyBookmarkPresentation() {
  const hidden = !applyVisibilityLayout().bookmarksVisible;
  bookmarks.setPresentation({ mobile: mobileViewport.matches, mode: settings.mobileBookmarksMode, hidden });
}

const settingsSync = createSettingsSync({ storage,
  captureObservers: () => ({ weather: weather.captureConfigurationObserver(), calendar: calendar.captureConfigurationObserver(), linkwarden: bookmarks.captureConfigurationObserver() }),
  onSnapshot(snapshot, observers) {
    const previous = settings;
    settings = { ...snapshot.preferences, location: settings.location };
    const changed = (keys) => keys.some((key) => !preferencesEqual(settings[key], previous[key]));
    const first = !servicesStarted;
    if (first || changed(['position', 'scale', 'timeVisible', 'timeScale', 'weatherVisible', 'weatherScale', 'calendarVisible', 'calendarScale', 'mobileTimeVisible', 'mobileTimeScale', 'mobileWeatherVisible', 'mobileWeatherScale', 'mobileCalendarVisible', 'mobileCalendarScale'])) applyPresentation();
    else if (changed(['timezone', 'dateStyle', 'hour12', 'seconds'])) startClock();
    if (first || changed(['mobileBookmarksMode', 'hideBookmarksFullscreen', 'bookmarksVisible', 'mobileBookmarksVisible', 'homeAssistantVisible', 'mobileHomeAssistantVisible', 'wolVisible', 'mobileWolVisible'])) applyBookmarkPresentation();
    if (changed(['widgetLayout'])) applyVisibilityLayout();
    if (first || changed(['homeAssistantDeviceSelections'])) deviceIntegrations.configure(settings.homeAssistantDeviceSelections);
    if (first || changed(['bookmarkLinkSelections'])) bookmarks.configure(settings.bookmarkLinkSelections);
    document.body.style.backgroundColor = settings.color;
    if (first || changed(['order', 'interval', 'duration', 'animation', 'opacity', 'background', 'color', 'blur', 'imageInfo'])) photos.configure(settings);
    if (first || changed(['timezone', 'temperature', 'wind', 'precipitation'])) weather.configure(settings);
    if (first) {
      servicesStarted = true; void photos.load();
      if (!snapshot.integrations.weather.available) void weather.refresh();
      if (!snapshot.integrations.calendar.available) void calendar.start();
      if (!snapshot.integrations.linkwarden.available) void bookmarks.start();
    }
    observers.weather?.(snapshot.integrations.weather);
    const enabled = settings.calendarVisible || settings.mobileCalendarVisible;
    if (!observers.calendar?.(snapshot.integrations.calendar, enabled) && changed(['calendarVisible', 'mobileCalendarVisible'])) calendar.configure({ calendarVisible: enabled });
    observers.linkwarden?.(snapshot.integrations.linkwarden);
    if (changed(['hour12'])) renderWeather();
    if (changed(['timezone', 'hour12'])) renderCalendar();
    if (changed(PREFERENCE_KEYS)) preferenceMessage = '';
    if (!dialog.open || !draftDirty) { fillForm(); draftRevision = snapshot.revision; }
  },
  onState(state) {
    const saving = state.pending;
    for (const control of preferences.elements) if (PREFERENCE_KEYS.includes(control.name)) control.disabled = saving;
    deviceSelection.setSaving(saving);
    bookmarkSelection.setSaving(saving);
    layoutEditor.setSaving(saving);
    $('save-preferences').disabled = saving || !state.confirmed || (dialog.open && draftRevision === null);
    $('reload-shared-preferences').disabled = saving || !state.confirmed;
    $('settings-status').textContent = saving ? 'Saving shared preferences…' : state.error ? state.error : preferenceMessage || (state.confirmed ? 'Preferences are shared across all browsers.' : state.cache ? 'Using cached shared preferences while loading the server.' : 'Loading shared preferences…');
  }
});

dialog.addEventListener('input', (event) => { if (event.target.form === preferences) draftDirty = true; });
preferences.addEventListener('submit', async (event) => {
  event.preventDefault();
  const invalid = [...preferences.elements].find((control) => control.willValidate && !control.validity.valid);
  if (invalid) { settingsTabs.reveal(invalid); invalid.reportValidity(); return; }
  const layoutInvalid = $('widget-layout-editor').querySelector('input:invalid:not(:disabled)');
  if (layoutInvalid) { settingsTabs.reveal(layoutInvalid); layoutInvalid.reportValidity(); return; }
  const session = settingsSession;
  try {
    const next = readPreferenceDraft(); draftDirty = true;
    const saved = await settingsSync.save(next, draftRevision);
    if (session !== settingsSession) return;
    draftRevision = saved.revision; draftDirty = false; fillForm(); preferenceMessage = 'Preferences saved for all browsers.';
    $('settings-status').textContent = preferenceMessage;
  } catch (error) { if (session === settingsSession) $('settings-status').textContent = error.message || 'Shared preferences could not be saved.'; }
});
$('reload-shared-preferences').addEventListener('click', () => {
  fillForm(); draftRevision = settingsSync.getState().snapshot.revision; draftDirty = false; preferenceMessage = 'Shared preferences reloaded. Reapply your changes before saving.'; $('settings-status').textContent = preferenceMessage;
});
function fillCalendarForm() {
  const state = calendar.getState();
  $('calendar-url').value = state.serverUrl ?? '';
  $('calendar-username').value = state.username ?? '';
  $('calendar-password').value = '';
  $('disconnect-calendar').disabled = !state.configured && !state.needsReauthentication;
}
function fillLinkwardenForm() {
  const state = bookmarks.getState();
  $('linkwarden-url').value = state.baseUrl ?? ''; $('linkwarden-username').value = state.username ?? ''; $('linkwarden-token').value = '';
  $('linkwarden-settings-status').textContent = state.needsReauthentication ? 'Linkwarden needs re-authentication. Enter an access token.' : !state.encryptionReady && state.discovered ? 'Configure the server encryption key before connecting Linkwarden.' : '';
}
function setCalendarMutationPending(pending) {
  $('connect-calendar').disabled = pending;
  $('disconnect-calendar').disabled = pending || (!calendar.getState().configured && !calendar.getState().needsReauthentication);
}
$('open-settings').addEventListener('click', () => {
  settingsSession++;
  draftDirty = false; draftRevision = settingsSync.getState().confirmed ? settingsSync.getState().snapshot.revision : null;
  fillForm(); fillCalendarForm(); fillLinkwardenForm(); $('calendar-settings-status').textContent = '';
  settingsTabs.select('settings-tab-general');
  void settingsSync.refresh();
  dialog.showModal();
  integrationSettings.open();
  $('settings-tab-general').focus();
});
$('close-settings').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (layoutEditor.cancelGesture()) event.preventDefault(); });
dialog.addEventListener('close', () => { settingsSession++; layoutEditor.cancelGesture(); draftDirty = false; integrationSettings.close(); deviceIntegrations.setPickerOpen(false); bookmarks.setPickerOpen(false); $('open-settings').focus(); });
function cancelSearch() { searchGeneration++; searchController?.abort(); }
$('location-search').addEventListener('submit', async (event) => {
  event.preventDefault(); cancelSearch(); const request = searchGeneration;
  searchController = new AbortController();
  $('location-results').replaceChildren(); $('search-status').textContent = 'Searching…';
  try {
    const results = await searchLocations($('location-query').value, { signal: searchController.signal });
    if (request !== searchGeneration) return;
    $('search-status').textContent = results.length ? 'Select a location.' : 'No matching locations.';
    for (const location of results) {
      const item = document.createElement('li'); const button = element('button', location.label); button.type = 'button';
      button.disabled = Boolean(weatherState.mutationPending) || !weatherState.discovered;
      button.addEventListener('click', async () => {
        const release = settingsSync.beginIntegrationAction('weather');
        const resultGeneration = searchGeneration;
        $('location-settings-status').textContent = 'Saving weather location…';
        try {
          const saved = await weather.saveLocation(location);
          $('location-settings-status').textContent = `Saved ${saved.label} on this server.`;
          if (resultGeneration === searchGeneration) $('search-status').textContent = `Selected ${saved.label}.`;
        } catch (error) { $('location-settings-status').textContent = error.message || 'Weather location could not be saved.'; }
        finally { release(); }
      });
      item.append(button); $('location-results').append(item);
    }
  } catch { if (request === searchGeneration) $('search-status').textContent = 'Location search unavailable. Please try again.'; }
});
$('clear-location').addEventListener('click', () => { cancelSearch(); $('location-results').replaceChildren(); $('search-status').textContent = 'Search results cleared.'; });

$('calendar-connection').addEventListener('submit', async (event) => {
  event.preventDefault();
  const release = settingsSync.beginIntegrationAction('calendar');
  setCalendarMutationPending(true); $('calendar-settings-status').textContent = 'Connecting to Baikal…';
  try {
    await calendar.connect({ serverUrl: $('calendar-url').value, username: $('calendar-username').value, password: $('calendar-password').value });
    const state = calendar.getState();
    if (state.configured && !state.error) { $('calendar-settings-status').textContent = 'Calendar connected.'; fillCalendarForm(); dialog.close(); }
    else $('calendar-settings-status').textContent = state.error || 'Calendar could not be connected.';
  } finally { setCalendarMutationPending(false); release(); }
});
$('disconnect-calendar').addEventListener('click', async () => {
  if (!confirm('Disconnect the Baikal calendar and delete its saved credentials?')) return;
  const release = settingsSync.beginIntegrationAction('calendar');
  setCalendarMutationPending(true); $('calendar-settings-status').textContent = 'Disconnecting calendar…';
  try {
    await calendar.disconnect();
    const state = calendar.getState();
    $('calendar-settings-status').textContent = state.configured ? (state.error || 'Calendar could not be disconnected.') : 'Calendar disconnected.';
    fillCalendarForm();
  } finally { setCalendarMutationPending(false); release(); }
});

$('linkwarden-connection').addEventListener('submit', async (event) => {
  event.preventDefault(); $('linkwarden-settings-status').textContent = 'Connecting to Linkwarden…';
  const release = settingsSync.beginIntegrationAction('linkwarden');
  try {
    await bookmarks.connect({ url: $('linkwarden-url').value, username: $('linkwarden-username').value, accessToken: $('linkwarden-token').value });
    $('linkwarden-token').value = ''; $('linkwarden-settings-status').textContent = 'Linkwarden connected.';
  } catch (error) { $('linkwarden-settings-status').textContent = error.message || 'Linkwarden could not be connected.'; }
  finally { release(); }
});
$('disconnect-linkwarden').addEventListener('click', async () => {
  if (!confirm('Disconnect Linkwarden and delete its saved access token?')) return;
  const release = settingsSync.beginIntegrationAction('linkwarden');
  $('linkwarden-settings-status').textContent = 'Disconnecting Linkwarden…';
  try { await bookmarks.disconnect(); fillLinkwardenForm(); $('linkwarden-settings-status').textContent = 'Linkwarden disconnected.'; }
  catch (error) { $('linkwarden-settings-status').textContent = error.message || 'Linkwarden could not be disconnected.'; }
  finally { release(); }
});

function fullscreenState() { $('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'; applyBookmarkPresentation(); }
if (!document.fullscreenEnabled) { $('fullscreen').disabled = true; $('fullscreen').textContent = 'Fullscreen unavailable'; }
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); $('page-status').textContent = ''; }
  catch { $('page-status').textContent = 'Fullscreen could not be enabled in this browser.'; }
});
document.addEventListener('fullscreenchange', fullscreenState);
document.addEventListener('visibilitychange', () => { startClock(); photos.setVisible(!document.hidden); weather.setVisible(!document.hidden); calendar.setVisible(!document.hidden); bookmarks.setVisible(!document.hidden); settingsSync.setVisible(!document.hidden); deviceIntegrations.setVisible(!document.hidden); if (document.hidden) stopAnimations(); });
reducedMotion.addEventListener('change', () => { stopAnimations(); photos.configure(settings); });
mobileViewport.addEventListener('change', applyPresentation);
window.addEventListener('pagehide', (event) => { clearInterval(clockTimer); cancelSearch(); layoutEditor.cancelGesture(); weather.dispose(); photos.dispose(); if (event.persisted) { bookmarks.setVisible(false); settingsSync.setVisible(false); deviceIntegrations.setVisible(false); integrationSettings.suspend(); } else { layoutEditor.dispose(); layoutView.dispose(); calendar.dispose(); bookmarks.dispose(); settingsSync.dispose(); integrationSettings.dispose(); deviceIntegrations.dispose(); } });
window.addEventListener('pageshow', (event) => { if (event.persisted) { void photos.load(); applyPresentation(); weather.configure(settings); void weather.refresh(); void calendar.refresh(); bookmarks.setVisible(!document.hidden); settingsSync.setVisible(!document.hidden); deviceIntegrations.setVisible(!document.hidden); } });
photos.setVisible(!document.hidden); weather.setVisible(!document.hidden); calendar.setVisible(!document.hidden);
bookmarks.setVisible(!document.hidden);
deviceIntegrations.setVisible(!document.hidden);
settings = { ...settingsSync.getState().snapshot.preferences, location: null };
fillForm(); document.body.style.backgroundColor = settings.color; applyPresentation(); settingsSync.setVisible(!document.hidden); void settingsSync.start();
