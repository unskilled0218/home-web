import { SETTINGS_KEY, clockText, loadSettings, normalizeSettings, sampleHours, weatherDescription, weatherIconKey } from './dashboard-helpers.js';
import { createWeatherController, searchLocations } from './dashboard-weather.js';
import { createPhotoController } from './dashboard-photos.js';

const $ = (id) => document.getElementById(id);
let storage;
try { storage = window.localStorage; } catch { /* Defaults work when browser storage is blocked. */ }
let settings = loadSettings(storage);
let clockTimer; let searchController; let searchGeneration = 0; let weatherState = {}; let animations = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const preferences = $('preferences');
const dialog = $('settings-dialog');

function save() {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); $('settings-status').textContent = 'Preferences saved in this browser.'; }
  catch { $('settings-status').textContent = 'Browser storage is unavailable. Preferences apply for this session only.'; }
}

function fillForm() {
  for (const control of preferences.elements) {
    if (!(control.name in settings)) continue;
    if (control.type === 'checkbox') control.checked = settings[control.name];
    else control.value = settings[control.name];
  }
}

function updateClock() {
  const now = new Date(); const formatted = clockText(now, settings);
  $('date').textContent = formatted.date; $('time').textContent = formatted.time; $('time').dateTime = now.toISOString();
}

function startClock() { clearInterval(clockTimer); updateClock(); if (!document.hidden && settings.timeVisible) clockTimer = setInterval(updateClock, 1000); }
function element(tag, content, className) { const node = document.createElement(tag); node.textContent = content; if (className) node.className = className; return node; }
const reading = (value, unit = '') => value === null || value === undefined ? 'Unavailable' : `${value}${unit ? ` ${unit}` : ''}`;

function renderWeather(state = weatherState) {
  weatherState = state;
  $('location-name').textContent = settings.location?.label ?? 'Weather';
  const forecast = state.forecast;
  $('weather-status').textContent = !settings.location ? 'Choose a location in Settings to show weather.' : state.forecastError ? (forecast ? 'Forecast is stale; refresh failed. Retrying hourly.' : 'Forecast unavailable. Retrying hourly.') : state.loading ? 'Updating weather…' : state.forecastUpdated ? `Updated ${new Date(state.forecastUpdated).toLocaleTimeString([], { timeZone: settings.timezone })}` : '';
  const icon = $('weather-icon'); const iconUse = $('weather-icon-use');
  icon.hidden = true; iconUse.removeAttribute('href');
  $('current-weather-values').replaceChildren(); $('hourly').replaceChildren(); $('daily').replaceChildren();
  $('forecast-details').hidden = !forecast;
  if (forecast) {
    const current = forecast.current; const units = forecast.units;
    iconUse.setAttribute('href', `/weather-icons.svg#${weatherIconKey(current.weather_code, current.is_day)}`); icon.hidden = false;
    $('current-weather-values').append(element('strong', reading(current.temperature_2m, units.temperature_2m), 'temperature'), element('span', weatherDescription(current.weather_code, current.is_day), 'condition'), element('span', `Wind ${reading(current.wind_speed_10m, units.wind_speed_10m)}`), element('span', `Humidity ${reading(current.relative_humidity_2m, units.relative_humidity_2m)}`), element('span', `Precipitation ${reading(current.precipitation, units.precipitation)}`));
    for (const hour of sampleHours(forecast.hourly)) {
      const label = new Intl.DateTimeFormat(undefined, { timeZone: settings.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: settings.hour12 }).format(new Date(hour.time * 1000));
      $('hourly').append(element('li', `${label}: ${reading(hour.temperature, forecast.hourlyUnit)} · ${weatherDescription(hour.code)}`));
    }
    if (!$('hourly').children.length) $('hourly').append(element('li', 'Hourly forecast unavailable.'));
    for (const day of forecast.daily) {
      const label = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00Z`));
      $('daily').append(element('li', `${label}: ${reading(day.min, forecast.dailyUnit)} to ${reading(day.max, forecast.dailyUnit)} · ${weatherDescription(day.code)}`));
    }
    if (!$('daily').children.length) $('daily').append(element('li', 'Daily forecast unavailable.'));
  }
  $('air-quality').textContent = !settings.location ? '' : state.air ? `US AQI: ${state.air.aqi}${state.airError ? ' (stale; refresh failed)' : ''}` : state.airError ? 'Air quality unavailable.' : state.loading ? 'Loading air quality…' : '';
}

const weather = createWeatherController({ onChange: renderWeather });
function stopAnimations() { animations.forEach((animation) => animation.cancel()); animations = []; }
function clearPhotos() { stopAnimations(); $('photos').replaceChildren(); $('photo-caption').textContent = ''; }
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
    if (previous && options.animation !== 'none' && options.duration > 0 && !reducedMotion.matches && layer.animate) {
      const frames = options.animation === 'slide' ? [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }] : [{ opacity: 0 }, { opacity: options.opacity }];
      const animation = layer.animate(frames, { duration: options.duration * 1000, easing: 'ease-in-out' });
      animations.push(animation);
      if (options.animation === 'fade') animations.push(previous.animate([{ opacity: Number(previous.style.opacity) }, { opacity: 0 }], { duration: options.duration * 1000, fill: 'forwards' }));
      animation.finished.then(() => { previous.remove(); }, () => {});
    } else previous?.remove();
  }
});

function apply() {
  document.body.style.backgroundColor = settings.color;
  $('information').classList.toggle('right', settings.position === 'right');
  $('information').style.setProperty('--scale', settings.scale);
  $('clock').style.setProperty('--time-scale', settings.timeScale);
  $('weather').style.setProperty('--weather-scale', settings.weatherScale);
  $('clock').hidden = !settings.timeVisible; $('weather').hidden = !settings.weatherVisible;
  startClock(); photos.configure(settings); weather.configure(settings); renderWeather();
}

preferences.addEventListener('submit', (event) => {
  event.preventDefault();
  const next = { ...settings };
  for (const control of preferences.elements) {
    if (!(control.name in settings)) continue;
    next[control.name] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? control.valueAsNumber : control.value;
  }
  settings = normalizeSettings(next); save(); fillForm(); apply();
});
$('open-settings').addEventListener('click', () => { fillForm(); dialog.showModal(); });
$('close-settings').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => $('open-settings').focus());
$('photo-files').addEventListener('change', (event) => photos.select(event.target.files));

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
      button.addEventListener('click', () => { settings = normalizeSettings({ ...settings, location }); save(); apply(); $('search-status').textContent = `Selected ${location.label}.`; });
      item.append(button); $('location-results').append(item);
    }
  } catch { if (request === searchGeneration) $('search-status').textContent = 'Location search unavailable. Please try again.'; }
});
$('clear-location').addEventListener('click', () => { cancelSearch(); settings = normalizeSettings({ ...settings, location: null }); save(); apply(); $('location-results').replaceChildren(); $('search-status').textContent = 'Location cleared.'; });

function fullscreenState() { $('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'; }
if (!document.fullscreenEnabled) { $('fullscreen').disabled = true; $('fullscreen').textContent = 'Fullscreen unavailable'; }
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); $('page-status').textContent = ''; }
  catch { $('page-status').textContent = 'Fullscreen could not be enabled in this browser.'; }
});
document.addEventListener('fullscreenchange', fullscreenState);
document.addEventListener('visibilitychange', () => { startClock(); photos.setVisible(!document.hidden); weather.setVisible(!document.hidden); if (document.hidden) stopAnimations(); });
reducedMotion.addEventListener('change', () => { stopAnimations(); photos.configure(settings); });
window.addEventListener('pagehide', () => { clearInterval(clockTimer); cancelSearch(); weather.dispose(); photos.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) { $('photo-status').textContent = 'Reselect photos after returning to this page.'; startClock(); void weather.refresh(); } });
photos.setVisible(!document.hidden); weather.setVisible(!document.hidden);
fillForm(); apply();
