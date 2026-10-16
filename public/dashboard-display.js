import { resolveDisplayPreferences } from './dashboard-helpers.js';

// Pure projection shared by lifecycle updates and DOM-only photo-caption callbacks.
export function dashboardDisplay(settings, { mobile = false, fullscreen = false, caption = false } = {}) {
  const display = resolveDisplayPreferences(settings, mobile);
  for (const name of ['time', 'weather', 'calendar', 'bookmarks', 'homeAssistant', 'wol']) {
    const hide = `hide${name[0].toUpperCase()}${name.slice(1)}Fullscreen`;
    display[`${name}Visible`] &&= !(fullscreen && settings[hide]);
  }
  const bookmarksVisible = display.bookmarksVisible;
  const information = display.timeVisible || display.weatherVisible || display.calendarVisible || caption;
  const devices = display.homeAssistantVisible || display.wolVisible;
  const columns = [];
  if (information) columns.push('minmax(0, 1fr)');
  if (devices) columns.push(bookmarksVisible ? 'clamp(14rem, 22vw, 20rem)' : 'clamp(14rem, 24vw, 22rem)');
  if (bookmarksVisible) columns.push(devices ? 'clamp(10rem, 24vw, 22rem)' : 'clamp(14rem, 24vw, 22rem)');
  return { ...display, bookmarksVisible, information, devices, columns: columns.join(' '), deviceRows: display.homeAssistantVisible && display.wolVisible ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', content: information || devices || bookmarksVisible, backgroundOnly: !display.timeVisible && !display.weatherVisible && !display.calendarVisible && !devices && !bookmarksVisible };
}

// Deliberately contains no timer, controller, request, or preference mutation.
export function applyDashboardDisplay(document, display) {
  const node = (id) => document.getElementById(id);
  for (const [id, visible] of Object.entries({ clock: display.timeVisible, weather: display.weatherVisible, calendar: display.calendarVisible, bookmarks: display.bookmarksVisible, 'dashboard-ha': display.homeAssistantVisible, 'dashboard-wol': display.wolVisible, information: display.information, 'dashboard-devices': display.devices, 'dashboard-content': display.content })) node(id).hidden = !visible;
  node('dashboard-content').style.setProperty('--dashboard-columns', display.columns || 'minmax(0, 1fr)');
  node('dashboard-devices').style.setProperty('--device-rows', display.deviceRows);
  document.body.classList.toggle('bookmarks-shown', display.bookmarksVisible);
  document.body.classList.toggle('background-only', display.backgroundOnly);
}
