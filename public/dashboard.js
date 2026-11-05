import { MOBILE_MEDIA_QUERY, clockText, normalizeDashboardPreferences, preferencesEqual, resolveDisplayPreferences, sampleHours, temperatureRange, weatherDescription, weatherIconFile } from './dashboard-helpers.js';
import { searchLocations } from './dashboard-weather.js';
import { createScopedPhotoController } from './dashboard-photo-scope.js';
import { createPhotoStatusController } from './dashboard-photo-status.js';
import { createScopedWeatherController } from './dashboard-weather-scope.js';
import { createCalendarController, formatCalendarEvent } from './dashboard-calendar.js';
import { createSettingsTabs } from './dashboard-settings.js';
import { formatWeatherUpdated } from './weather-data.js';
import { createBookmarkController } from './dashboard-bookmarks.js';
import { createBookmarkList } from './dashboard-bookmark-list.js';
import { createBookmarkSelection } from './dashboard-bookmark-selection.js';
import { safeBookmarkUrl } from './bookmark-data.js';
import { createSettingsScope } from './dashboard-settings-scope.js';
import { createSettingsTransferControls } from './dashboard-settings-transfer.js';
import { createIntegrationSettings } from './dashboard-integration-settings.js';
import { createDashboardDevices } from './dashboard-devices.js';
import { createDeviceSelection } from './dashboard-device-selection.js';
import { createDashboardDeviceView } from './dashboard-device-view.js';
import { dashboardDisplay, applyDashboardDisplay } from './dashboard-display.js';
import { createDashboardLayoutView } from './dashboard-layout-view.js';
import { createDashboardLayoutEditor } from './dashboard-layout-editor.js';
import { createLayoutActivation } from './dashboard-layout-activation.js';
import { CATEGORY_IDS, settingsCategory, categoryPreferences } from './dashboard-settings-categories.js';
import { createCategoryDrafts } from './dashboard-settings-drafts.js';
import { createCategoryControls } from './dashboard-category-controls.js';

const $ = (id) => document.getElementById(id);
const currentWeatherSubValues = document.createElement('div');
currentWeatherSubValues.id = 'current-weather-subvalues';

let storage;
try { storage = window.localStorage; } catch { /* Defaults work when browser storage is blocked. */ }
let settings = { ...normalizeDashboardPreferences(), location: null };
let servicesStarted = false; let activeCategory = 'general'; let settingsTransfer; let followGlobalPhotos = true;
let activeSources = {}; const drafts = createCategoryDrafts(); const admissions = new Map();
const globalMode = id => settingsSync.getCategoryState(id).mode === 'global';
let clockTimer; let searchController; let searchGeneration = 0; let weatherState = {}; let calendarState = {}; let animations = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobileViewport = matchMedia(MOBILE_MEDIA_QUERY);
let settingsSession = 0; let layoutEditor;
let layoutActivation;
const preferences = $('preferences');
const dialog = $('settings-dialog');
const layoutView = createDashboardLayoutView({ document, window, onMeasure: () => layoutEditor?.refreshSurface() });
layoutEditor = createDashboardLayoutEditor({ document, window, view: layoutView, getState: () => settingsSync.getCategoryState('general'), save: (patch, revision) => settingsSync.saveCategory('general', patch, revision), canEnter: () => !dialog.open && !settingsSync.getCategoryState('general').pending, activeProfile: () => mobileViewport.matches ? 'mobile' : 'desktop', toggleFullscreen: () => toggleFullscreen(), activationBlocked: () => layoutActivation?.blocked() });
layoutActivation = createLayoutActivation({ document, window, canEnter: () => !layoutEditor.active && !dialog.open && !settingsSync.getCategoryState('general').pending, activate: (id, node) => layoutEditor.enter(id, node) });
$('edit-layout').addEventListener('click', () => layoutEditor.enter());
const photoStatus = createPhotoStatusController({ report: message => { $('photo-count').textContent = message; } });
const showPhotoStatus = () => photoStatus.setVisible(!document.hidden && dialog.open && $('settings-tab-images').getAttribute('aria-selected') === 'true');
const settingsTabs = createSettingsTabs(dialog, { onSelect: (id) => { activeCategory = id.slice('settings-tab-'.length); deviceIntegrations.setPickerOpen(dialog.open && id === 'settings-tab-home-assistant'); bookmarks.setPickerOpen(dialog.open && id === 'settings-tab-bookmarks'); showPhotoStatus(); renderSettingsState(); } });
const deviceView = createDashboardDeviceView({ document, wake: (id) => { if (!layoutEditor.active) return deviceIntegrations.wake(id); } });
const deviceSelection = createDeviceSelection({ document, root: $('home-assistant-device-picker'), status: $('home-assistant-selection-status'), onChange: () => markDirty('home-assistant') });
const deviceIntegrations = createDashboardDevices({ fetchImpl: installationFetch, onChange: (state) => { deviceView.render(state); deviceSelection.update(state); } });
const integrationSettings = createIntegrationSettings({ document, homeAssistant: deviceIntegrations.homeAssistant, wol: deviceIntegrations.wol, canMutate: globalMode, captureMutation: id => settingsSync.getCategoryState(id).saveToken, beginMutation: beginAction });
const bookmarkList = createBookmarkList({ root: $('bookmark-tree'), status: $('bookmarks-status'), onRetry: (id) => bookmarks.retryFolder(id) });
const bookmarkSelection = createBookmarkSelection({ document, root: $('bookmark-link-picker'), foldersRoot: $('bookmark-picker-folders'), status: $('bookmark-selection-status'), selectNone: $('bookmark-select-none'), reload: $('bookmark-reload-folders'), onChange: () => markDirty('bookmarks'), onToggle: (id, open) => bookmarks.setPickerFolderOpen(id, open), onReload: () => bookmarks.reloadPickerFolders() });
const bookmarks = createBookmarkController({ fetchImpl: scopedFetch('bookmarks'), onChange(state) {
  bookmarkList.render(state.dashboard); bookmarkSelection.update(state);
  const link = $('open-linkwarden'); const url = safeBookmarkUrl(state.baseUrl);
  link.hidden = !url; if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; } else link.removeAttribute('href');
  $('connect-linkwarden').disabled = !globalMode('bookmarks') || state.mutationPending || (state.discovered && !state.encryptionReady);
  $('linkwarden-token').required = state.needsReauthentication || !state.accessTokenPresent;
  $('disconnect-linkwarden').disabled = !globalMode('bookmarks') || state.mutationPending || (!state.configured && !state.accessTokenPresent);
} });

function scopedFetch(id) {
  return (url, options = {}) => {
    if (options.method && options.method !== 'GET' && !['/api/weather/refresh', '/api/weather/local'].includes(url) && !/\/wake$/.test(url)) {
      const admission = admissions.get(id); if (!admission) throw new Error('No settings action was admitted.'); admission.check();
    }
    return fetch(url, options);
  };
}
function installationFetch(url, options) { return scopedFetch(String(url).startsWith('/api/home-assistant') ? 'home-assistant' : 'wol')(url, options); }
function beginAction(name, token) {
  const id = name === 'linkwarden' ? 'bookmarks' : name;
  const release = settingsSync.beginIntegrationAction(name, token ?? settingsSync.getCategoryState(id).saveToken);
  admissions.set(id, release);
  return () => { if (admissions.get(id) === release) admissions.delete(id); release(); };
}
function markDirty(id) { drafts.dirty(id); renderSettingsState(); settingsTransfer?.update(); }
function fillCategory(id) {
  const state = settingsSync.getCategoryState(id); const draft = drafts.load(id, state); const keys = settingsCategory(id).keys;
  for (const control of preferences.elements) {
    if (!keys.includes(control.name)) continue;
    if (control.type === 'checkbox') control.checked = settings[control.name];
    else control.value = settings[control.name];
  }
  if (id === 'home-assistant') deviceSelection.setDraft(settings.homeAssistantDeviceSelections);
  if (id === 'bookmarks') bookmarkSelection.setDraft(settings.bookmarkLinkSelections);
  if (id === 'images') $('follow-global-photos').checked = followGlobalPhotos;
  updatePhotoControls();
  return draft;
}
function fillForm() { for (const id of CATEGORY_IDS) fillCategory(id); }

function updatePhotoControls() {
  const saving = settingsSync.getCategoryState('images').pending;
  const following = !globalMode('images') && $('follow-global-photos').checked;
  $('local-photo-controls').hidden = globalMode('images');
  $('follow-global-photos').disabled = saving || globalMode('images');
  for (const name of ['order', 'interval']) preferences.elements.namedItem(name).disabled = saving || following;
  $('photo-following-help').hidden = !following;
}

function readPreferenceDraft(id) {
  const draft = drafts.get(id); const next = { ...draft.baseline }; const keys = settingsCategory(id).keys;
  for (const control of preferences.elements) {
    if (!keys.includes(control.name)) continue;
    next[control.name] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? control.valueAsNumber : control.value;
  }
  if (id === 'home-assistant') next.homeAssistantDeviceSelections = deviceSelection.getDraft();
  if (id === 'bookmarks') next.bookmarkLinkSelections = bookmarkSelection.getDraft();
  return categoryPreferences(id, normalizeDashboardPreferences(next));
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
  $('hourly').hidden = !settings.weatherHourlyVisible; $('daily').hidden = !settings.weatherDailyVisible;
  $('forecast-details').hidden = !forecast || !(settings.weatherHourlyVisible || settings.weatherDailyVisible);
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

const weather = createScopedWeatherController({ fetchImpl: scopedFetch('weather'), onChange: renderWeather, saveLocalLocation(location) { const admission = admissions.get('weather'); if (!admission) throw new Error('No Weather action was admitted.'); const state = admission.check(); settingsSync.saveLocalLocation(location, state.saveToken); return location; } });
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
const calendar = createCalendarController({ fetchImpl: scopedFetch('calendar'), onChange: renderCalendar, autoStart: false });
function stopAnimations() {
  animations.forEach((animation) => animation.cancel()); animations = [];
  const container = $('photos'); while (container.children.length > 1) releasePhotoLayer(container.firstElementChild);
}
function releasePhotoLayer(layer) { if (!layer) return; layer.photoResource?.release(); layer.photoResource = undefined; for (const image of layer.querySelectorAll('img')) image.removeAttribute('src'); layer.remove(); }
function applyVisibilityLayout() {
  const display = dashboardDisplay(settings, { mobile: mobileViewport.matches, fullscreen: Boolean(document.fullscreenElement), caption: Boolean($('photo-caption').textContent) });
  applyDashboardDisplay(document, display);
  layoutView.update({ layout: settings.widgetLayout, mobile: mobileViewport.matches, position: settings.position, scale: settings.scale, display });
  return display;
}
function clearPhotos() { stopAnimations(); releasePhotoLayer($('photos').lastElementChild); $('photo-caption').textContent = ''; applyVisibilityLayout(); }
function updatePhotoPresentation(photo, options) {
  const container = $('photos'); const layer = container.lastElementChild;
  if (!layer) return;
  stopAnimations(); while (container.children.length > 1) container.firstElementChild.remove();
  layer.style.opacity = options.opacity;
  let background = layer.querySelector('.photo-blur');
  if (options.background === 'blur') {
    if (!background) { background = new Image(); background.alt = ''; background.src = photo.url; background.className = 'photo-blur'; layer.prepend(background); }
    background.style.filter = `blur(${options.blur}px)`;
  } else if (background) { background.removeAttribute('src'); background.remove(); }
  $('photo-caption').textContent = options.imageInfo ? photo.file.name : ''; applyVisibilityLayout();
}
const photos = createScopedPhotoController({
  clear: clearPhotos,
  update: updatePhotoPresentation,
  report: (message) => { $('photo-status').textContent = message; },
  show(photo, options) {
    stopAnimations();
    const container = $('photos');
    while (container.children.length > 1) container.firstElementChild.remove();
    const previous = container.lastElementChild;
    const layer = document.createElement('div'); layer.className = 'photo-layer';
    if (options.background === 'blur') { const background = new Image(); background.alt = ''; background.src = photo.url; background.className = 'photo-blur'; background.style.filter = `blur(${options.blur}px)`; layer.append(background); }
    const image = photo.resource?.image ?? new Image(); layer.photoResource = photo.resource; image.alt = ''; if (!photo.resource) image.src = photo.url; layer.append(image); layer.style.opacity = options.opacity;
    container.append(layer);
    $('photo-caption').textContent = options.imageInfo ? photo.file.name : '';
    applyVisibilityLayout();
    if (previous && options.animation !== 'none' && options.duration > 0 && !reducedMotion.matches && layer.animate) {
      const frames = options.animation === 'slide' ? [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }] : [{ opacity: 0 }, { opacity: options.opacity }];
      const animation = layer.animate(frames, { duration: options.duration * 1000, easing: 'ease-in-out' });
      animations.push(animation);
      if (options.animation === 'fade') animations.push(previous.animate([{ opacity: Number(previous.style.opacity) }, { opacity: 0 }], { duration: options.duration * 1000, fill: 'forwards' }));
      animation.finished.then(() => { releasePhotoLayer(previous); }, () => {});
    } else releasePhotoLayer(previous);
  }
});

function applyWidgetScales() {
  const display = resolveDisplayPreferences(settings, mobileViewport.matches);
  for (const [id, property, value] of [['bookmarks', '--bookmarks-scale', display.bookmarksScale], ['dashboard-ha', '--home-assistant-scale', display.homeAssistantScale], ['dashboard-wol', '--wol-scale', display.wolScale]]) $(id).style.setProperty(property, value);
}

function applyPresentation() {
  const mobile = mobileViewport.matches;
  const display = resolveDisplayPreferences(settings, mobile);
  $('information').classList.toggle('right', display.position === 'right');
  $('information').style.setProperty('--scale', display.scale);
  $('clock').style.setProperty('--time-scale', display.timeScale);
  $('weather').style.setProperty('--weather-scale', display.weatherScale);
  $('calendar').style.setProperty('--calendar-scale', display.calendarScale);
  applyWidgetScales();
  startClock();
  applyBookmarkPresentation();
}

function applyBookmarkPresentation() {
  const hidden = !applyVisibilityLayout().bookmarksVisible;
  bookmarks.setPresentation({ mobile: mobileViewport.matches, mode: settings.mobileBookmarksMode, hidden });
}

const settingsSync = createSettingsScope({ storage,
  captureObservers: () => ({ weather: weather.captureConfigurationObserver(), calendar: calendar.captureConfigurationObserver(), linkwarden: bookmarks.captureConfigurationObserver() }),
  onSnapshot(snapshot, observers) {
    const previous = settings;
    const scope = settingsSync.getState();
    const changedSources = CATEGORY_IDS.filter(id => activeSources[id] !== scope.categories[id].source);
    const weatherSourceChanged = changedSources.includes('weather'); const imagesSourceChanged = changedSources.includes('images');
    const photoSourceChanged = followGlobalPhotos !== scope.followGlobalPhotos;
    activeSources = Object.fromEntries(CATEGORY_IDS.map(id => [id, scope.categories[id].source])); followGlobalPhotos = scope.followGlobalPhotos;
    if (weatherSourceChanged) { cancelSearch(); $('location-settings-status').textContent = ''; }
    if (changedSources.includes('general')) layoutEditor.cancelGesture();
    settings = { ...snapshot.preferences, location: scope.categories.weather.mode === 'local' ? scope.weatherLocation : weatherSourceChanged ? null : settings.location };
    const changed = (keys) => keys.some((key) => !preferencesEqual(settings[key], previous[key]));
    const first = !servicesStarted;
    const presentationChanged = first || changed(['position', 'scale', 'timeVisible', 'timeScale', 'weatherVisible', 'weatherScale', 'calendarVisible', 'calendarScale', 'mobileTimeVisible', 'mobileTimeScale', 'mobileWeatherVisible', 'mobileWeatherScale', 'mobileCalendarVisible', 'mobileCalendarScale']);
    if (presentationChanged) applyPresentation();
    else if (changed(['timezone', 'dateStyle', 'hour12', 'seconds'])) startClock();
    if (!presentationChanged && changed(['bookmarksScale', 'mobileBookmarksScale', 'homeAssistantScale', 'mobileHomeAssistantScale', 'wolScale', 'mobileWolScale'])) { applyWidgetScales(); applyVisibilityLayout(); }
    if (first || changed(['mobileBookmarksMode', 'hideBookmarksFullscreen', 'hideTimeFullscreen', 'hideWeatherFullscreen', 'hideCalendarFullscreen', 'hideHomeAssistantFullscreen', 'hideWolFullscreen', 'bookmarksVisible', 'mobileBookmarksVisible', 'homeAssistantVisible', 'mobileHomeAssistantVisible', 'wolVisible', 'mobileWolVisible'])) applyBookmarkPresentation();
    if (changed(['widgetLayout', 'imageVisible', 'mobileImageVisible', 'hideImageFullscreen'])) applyVisibilityLayout();
    if (first || changed(['homeAssistantDeviceSelections'])) deviceIntegrations.configure(settings.homeAssistantDeviceSelections);
    if (first || changed(['bookmarkLinkSelections'])) bookmarks.configure(settings.bookmarkLinkSelections);
    document.body.style.backgroundColor = settings.color;
    if (first || imagesSourceChanged || photoSourceChanged || changed(['order', 'interval', 'duration', 'animation', 'opacity', 'background', 'color', 'blur', 'imageInfo'])) photos.configure(settings, scope.categories.images.mode, scope.categories.images.source, followGlobalPhotos);
    if (first || weatherSourceChanged || changed(['timezone', 'temperature', 'wind', 'precipitation', 'location'])) weather.configure(settings, scope.categories.weather.mode, scope.categories.weather.source, scope.weatherLocation);
    if (first) {
      servicesStarted = true; void photos.load();
      if (!snapshot.integrations.calendar.available) void calendar.start();
      if (!snapshot.integrations.linkwarden.available) void bookmarks.start();
    }
    if (scope.categories.weather.mode === 'global') observers.weather?.(snapshot.integrations.weather);
    const enabled = settings.calendarVisible || settings.mobileCalendarVisible;
    if (!observers.calendar?.(snapshot.integrations.calendar, enabled) && changed(['calendarVisible', 'mobileCalendarVisible'])) calendar.configure({ calendarVisible: enabled });
    observers.linkwarden?.(snapshot.integrations.linkwarden);
    if (changed(['hour12', 'weatherHourlyVisible', 'weatherDailyVisible'])) renderWeather();
    if (changed(['timezone', 'hour12'])) renderCalendar();
    for (const id of CATEGORY_IDS) if (!dialog.open || !drafts.get(id)?.dirty) fillCategory(id);
    if (changedSources.length) { applyConnectionScope(); for (const id of changedSources) integrationSettings.updateScope(id); }
  },
  onState: () => renderSettingsState()
});

const categoryControls = createCategoryControls({ document, onChange: async (id, mode) => {
  try { await settingsSync.changeScope(id, mode, { canChange: !drafts.get(id)?.dirty && !(id === 'general' && layoutEditor.active) && !integrationSettings.isDirty(id) && !connectionDirty(id) }); }
  catch (error) { const draft = drafts.get(id); if (draft) draft.message = error.message; }
  renderSettingsState();
} });
function connectionDirty(id) { return id === 'calendar' ? calendarConnectionDirty : id === 'bookmarks' ? bookmarkConnectionDirty : false; }
let calendarConnectionDirty = false; let bookmarkConnectionDirty = false;
for (const [id, set] of [['calendar-connection', () => { calendarConnectionDirty = true; }], ['linkwarden-connection', () => { bookmarkConnectionDirty = true; }]]) $(id).addEventListener('input', set);
function renderSettingsState() {
  const state = settingsSync.getState(); const current = state.categories[activeCategory]; const draft = drafts.get(activeCategory); const label = settingsCategory(activeCategory).label;
  for (const id of CATEGORY_IDS) {
    const category = state.categories[id]; categoryControls.update(id, category);
    for (const control of preferences.elements) if (settingsCategory(id).keys.includes(control.name)) control.disabled = category.pending;
  }
  updatePhotoControls(); deviceSelection.setSaving(state.categories['home-assistant'].pending); bookmarkSelection.setSaving(state.categories.bookmarks.pending);
  layoutEditor.observe(); $('edit-layout').disabled = state.categories.general.pending || layoutEditor.active || dialog.open;
  const stale = drafts.stale(activeCategory, current);
  $('save-preferences').textContent = `Save ${label} settings`;
  $('save-preferences').disabled = current.pending || !current.confirmed || !draft?.token || stale;
  $('reload-shared-preferences').disabled = current.pending;
  $('reload-shared-preferences').textContent = `Reload ${current.mode === 'local' ? 'Local' : 'Global'} ${label} settings`;
  $('layout-reload').textContent = `Reload ${state.categories.general.mode} layout (discard edits)`;
  $('settings-status').textContent = stale ? `${label} settings scope changed. Reload this category before saving.` : current.pending ? `Saving ${label} settings…` : current.error || draft?.message || (!current.confirmed ? `Loading Global ${label} settings…` : `${label} settings use ${current.mode === 'local' ? 'Local values for this browser.' : 'Global shared values.'}`);
  $('category-scope-recovery').hidden = !state.scopeError; $('category-scope-error').textContent = state.scopeError;
  $('reset-category-scopes').disabled = !state.recoverable;
  settingsTransfer?.update();
}
function applyConnectionScope() {
  for (const [form, id] of [['calendar-connection', 'calendar'], ['linkwarden-connection', 'bookmarks']]) for (const control of $(form).elements) control.disabled = !globalMode(id);
  setCalendarMutationPending(false);
  const state = bookmarks.getState(); $('connect-linkwarden').disabled = !globalMode('bookmarks') || state.mutationPending || !state.encryptionReady; $('disconnect-linkwarden').disabled = !globalMode('bookmarks') || state.mutationPending || !state.accessTokenPresent;
}
settingsTransfer = createSettingsTransferControls({ document, window, coordinator: settingsSync, canImport: () => !drafts.anyDirty() && !layoutEditor.active && !calendarConnectionDirty && !bookmarkConnectionDirty && !integrationSettings.isDirty('home-assistant') && !integrationSettings.isDirty('wol') });
$('reset-category-scopes').addEventListener('click', async () => {
  try { const reset = await settingsSync.resetScopes(message => confirm(message)); const message = reset ? 'Category choices reset to Local. Reload any retained drafts before saving.' : 'Recovery canceled.'; $('category-scope-recovery-status').textContent = message; if (drafts.get('general')) drafts.get('general').message = message; }
  catch (error) { $('category-scope-recovery-status').textContent = error.message; }
  renderSettingsState();
});
window.addEventListener('storage', event => settingsSync.storageChanged(event));

dialog.addEventListener('input', (event) => { if (event.target.form === preferences) { const id = CATEGORY_IDS.find(id => settingsCategory(id).keys.includes(event.target.name)) ?? (event.target.id === 'follow-global-photos' ? 'images' : null); if (id) markDirty(id); } else settingsTransfer?.update(); });
preferences.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = activeCategory; const keys = settingsCategory(id).keys;
  const invalid = [...preferences.elements].find((control) => keys.includes(control.name) && control.willValidate && !control.validity.valid);
  if (invalid) { settingsTabs.reveal(invalid); invalid.reportValidity(); return; }
  const session = settingsSession;
  const draft = drafts.get(id); const source = draft?.source;
  try {
    const next = readPreferenceDraft(id); drafts.dirty(id);
    await settingsSync.saveCategory(id, next, draft.token, id === 'images' && !globalMode(id) ? { followGlobalPhotos: $('follow-global-photos').checked } : {});
    if (session !== settingsSession || source !== settingsSync.getCategoryState(id).source) return;
    const saved = fillCategory(id); saved.message = `${settingsCategory(id).label} settings saved ${globalMode(id) ? 'for all Global browsers.' : 'for this browser.'}`;
  } catch (error) { if (session === settingsSession && drafts.get(id)) drafts.get(id).message = error.message || 'Category settings could not be saved.'; }
  renderSettingsState();
});
$('reload-shared-preferences').addEventListener('click', async () => {
  const id = activeCategory; const session = settingsSession;
  await settingsSync.refresh();
  if (session !== settingsSession) return;
  const draft = fillCategory(id); draft.message = `${settingsCategory(id).label} settings reloaded. Reapply your changes before saving.`; await settingsTransfer.rebase(); if (session === settingsSession) renderSettingsState();
});
function fillCalendarForm() {
  const state = calendar.getState();
  $('calendar-url').value = state.serverUrl ?? '';
  $('calendar-username').value = state.username ?? '';
  $('calendar-password').value = '';
  calendarConnectionDirty = false; $('disconnect-calendar').disabled = !globalMode('calendar') || !state.configured && !state.needsReauthentication;
}
function fillLinkwardenForm() {
  const state = bookmarks.getState();
  bookmarkConnectionDirty = false;
  $('linkwarden-url').value = state.baseUrl ?? ''; $('linkwarden-username').value = state.username ?? ''; $('linkwarden-token').value = '';
  $('linkwarden-settings-status').textContent = state.needsReauthentication ? 'Linkwarden needs re-authentication. Enter an access token.' : !state.encryptionReady && state.discovered ? 'Configure the server encryption key before connecting Linkwarden.' : '';
}
function setCalendarMutationPending(pending) {
  $('connect-calendar').disabled = !globalMode('calendar') || pending;
  $('disconnect-calendar').disabled = !globalMode('calendar') || pending || (!calendar.getState().configured && !calendar.getState().needsReauthentication);
}
$('open-settings').addEventListener('click', () => {
  if (layoutEditor.active) return;
  layoutActivation.cancel();
  settingsSession++;
  drafts.clear();
  fillForm(); fillCalendarForm(); fillLinkwardenForm(); $('calendar-settings-status').textContent = '';
  settingsTabs.select('settings-tab-general');
  void settingsSync.refresh();
  dialog.showModal();
  $('edit-layout').disabled = true;
  integrationSettings.open();
  applyConnectionScope(); settingsTransfer.update();
  $('settings-tab-general').focus();
});
$('close-settings').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { photoStatus.setVisible(false); settingsSession++; drafts.clear(); $('edit-layout').disabled = settingsSync.getCategoryState('general').pending; integrationSettings.close(); deviceIntegrations.setPickerOpen(false); bookmarks.setPickerOpen(false); $('open-settings').focus(); });
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
        if (settingsSync.getCategoryState('weather').pending) return;
        const source = settingsSync.getCategoryState('weather').source;
        let release;
        const resultGeneration = searchGeneration;
        $('location-settings-status').textContent = 'Saving weather location…';
        try {
          release = beginAction('weather');
          const saved = await weather.saveLocation(location);
          if (source !== settingsSync.getCategoryState('weather').source) return;
          $('location-settings-status').textContent = globalMode('weather') ? `Saved ${saved.label} on this server.` : `Saved ${saved.label} for this browser.`;
          if (resultGeneration === searchGeneration) $('search-status').textContent = `Selected ${saved.label}.`;
        } catch (error) { $('location-settings-status').textContent = error.message || 'Weather location could not be saved.'; }
        finally { release?.(); }
      });
      item.append(button); $('location-results').append(item);
    }
  } catch { if (request === searchGeneration) $('search-status').textContent = 'Location search unavailable. Please try again.'; }
});
$('clear-location').addEventListener('click', () => { cancelSearch(); $('location-results').replaceChildren(); $('search-status').textContent = 'Search results cleared.'; });

$('calendar-connection').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!globalMode('calendar')) return;
  const source = settingsSync.getCategoryState('calendar').source;
  let release;
  setCalendarMutationPending(true); $('calendar-settings-status').textContent = 'Connecting to Baikal…';
  try {
    release = beginAction('calendar');
    await calendar.connect({ serverUrl: $('calendar-url').value, username: $('calendar-username').value, password: $('calendar-password').value });
    if (source !== settingsSync.getCategoryState('calendar').source) return;
    const state = calendar.getState();
    if (state.configured && !state.error) { $('calendar-settings-status').textContent = 'Calendar connected.'; fillCalendarForm(); dialog.close(); }
    else $('calendar-settings-status').textContent = state.error || 'Calendar could not be connected.';
  } catch (error) { $('calendar-settings-status').textContent = error.message; }
  finally { setCalendarMutationPending(false); release?.(); }
});
$('disconnect-calendar').addEventListener('click', async () => {
  if (!globalMode('calendar')) return;
  const token = settingsSync.getCategoryState('calendar').saveToken;
  if (!confirm('Disconnect the Baikal calendar and delete its saved credentials?')) return;
  let release;
  setCalendarMutationPending(true); $('calendar-settings-status').textContent = 'Disconnecting calendar…';
  try {
    release = beginAction('calendar', token);
    await calendar.disconnect();
    const state = calendar.getState();
    $('calendar-settings-status').textContent = state.configured ? (state.error || 'Calendar could not be disconnected.') : 'Calendar disconnected.';
    fillCalendarForm();
  } catch (error) { $('calendar-settings-status').textContent = error.message; }
  finally { setCalendarMutationPending(false); release?.(); }
});

$('linkwarden-connection').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!globalMode('bookmarks')) return; $('linkwarden-settings-status').textContent = 'Connecting to Linkwarden…';
  const source = settingsSync.getCategoryState('bookmarks').source;
  let release;
  try {
    release = beginAction('linkwarden');
    await bookmarks.connect({ url: $('linkwarden-url').value, username: $('linkwarden-username').value, accessToken: $('linkwarden-token').value });
    if (source !== settingsSync.getCategoryState('bookmarks').source) return;
    bookmarkConnectionDirty = false; $('linkwarden-token').value = ''; $('linkwarden-settings-status').textContent = 'Linkwarden connected.';
  } catch (error) { $('linkwarden-settings-status').textContent = error.message || 'Linkwarden could not be connected.'; }
  finally { release?.(); }
});
$('disconnect-linkwarden').addEventListener('click', async () => {
  if (!globalMode('bookmarks')) return;
  const token = settingsSync.getCategoryState('bookmarks').saveToken;
  if (!confirm('Disconnect Linkwarden and delete its saved access token?')) return;
  let release;
  $('linkwarden-settings-status').textContent = 'Disconnecting Linkwarden…';
  try { release = beginAction('linkwarden', token); await bookmarks.disconnect(); fillLinkwardenForm(); $('linkwarden-settings-status').textContent = 'Linkwarden disconnected.'; }
  catch (error) { $('linkwarden-settings-status').textContent = error.message || 'Linkwarden could not be disconnected.'; }
  finally { release?.(); }
});

function fullscreenState() { $('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'; applyBookmarkPresentation(); }
if (!document.fullscreenEnabled) { $('fullscreen').disabled = true; $('fullscreen').textContent = 'Fullscreen unavailable'; }
async function toggleFullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); $('page-status').textContent = ''; }
  catch { $('page-status').textContent = 'Fullscreen could not be enabled in this browser.'; }
}
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', fullscreenState);
document.addEventListener('visibilitychange', () => { showPhotoStatus(); startClock(); photos.setVisible(!document.hidden); weather.setVisible(!document.hidden); calendar.setVisible(!document.hidden); bookmarks.setVisible(!document.hidden); settingsSync.setVisible(!document.hidden); deviceIntegrations.setVisible(!document.hidden); if (document.hidden) stopAnimations(); });
reducedMotion.addEventListener('change', stopAnimations);
mobileViewport.addEventListener('change', applyPresentation);
window.addEventListener('pagehide', (event) => { clearInterval(clockTimer); cancelSearch(); layoutActivation.cancel(); layoutEditor.cancelGesture(); weather.dispose(); if (event.persisted) { photos.setVisible(false); bookmarks.setVisible(false); settingsSync.setVisible(false); deviceIntegrations.setVisible(false); integrationSettings.suspend(); } else { settingsTransfer.dispose(); photos.dispose(); layoutActivation.dispose(); layoutEditor.dispose(); layoutView.dispose(); calendar.dispose(); bookmarks.dispose(); settingsSync.dispose(); integrationSettings.dispose(); deviceIntegrations.dispose(); } });
window.addEventListener('pageshow', (event) => { if (event.persisted) { photos.setVisible(!document.hidden); applyPresentation(); const scope = settingsSync.getState(); const current = scope.categories.weather; weather.configure(settings, current.mode, current.source, scope.weatherLocation); void weather.refresh(); void calendar.refresh(); bookmarks.setVisible(!document.hidden); settingsSync.setVisible(!document.hidden); deviceIntegrations.setVisible(!document.hidden); } });
window.addEventListener('online', () => { if (servicesStarted) { void photos.load(); void settingsSync.refresh(); void weather.refresh(); } });
window.addEventListener('pagehide', event => { if (event.persisted) photoStatus.setVisible(false); else photoStatus.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) showPhotoStatus(); });
photos.setVisible(!document.hidden); weather.setVisible(!document.hidden); calendar.setVisible(!document.hidden);
bookmarks.setVisible(!document.hidden);
deviceIntegrations.setVisible(!document.hidden);
settings = { ...settingsSync.getState().snapshot.preferences, location: null };
fillForm(); document.body.style.backgroundColor = settings.color; applyPresentation(); settingsSync.setVisible(!document.hidden); void settingsSync.start();
