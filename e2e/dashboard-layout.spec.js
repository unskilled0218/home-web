import { expect } from '@playwright/test';
import { globalTest as test, globalFirefox as firefox } from './global-fixtures.js';
import { saveCategory, setPreferenceFlags } from './category-settings.js';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { initialWidgetProfile, defaultWidgetLayout, projectWidget } from '../public/dashboard-layout.js';
import { encryptApiKey } from '../src/linkwarden-crypto.js';
import { normalizeForecast } from '../public/weather-data.js';
import { rawForecast } from '../test/fixtures/weather.js';
import { mockSlideshow } from './photo-fixtures.js';

async function environment(preferences = {}, services = {}) {
  const directory = mkdtempSync('/tmp/opencode/dashboard-layout-'); const filename = `${directory}/app.db`;
  let store; let server; let base;
  const secret = Buffer.alloc(32, 9).toString('base64');
  async function start() { store = createStore(filename); server = createDashboardServer({ store, ...services, runtimeConfig: { allowedHosts: ['127.0.0.1'], linkwardenEncryptionKey: secret, wakeCooldownSeconds: 20 } }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await new Promise(resolve => server.close(resolve)); store.close(); }
  await start(); store.saveDashboardPreferences(normalizeDashboardPreferences(preferences), 0);
  return { secret, get base() { return base; }, get store() { return store; }, async restart() { await stop(); await start(); }, async close() { await stop(); rmSync(directory, { recursive: true, force: true }); } };
}
const layout = () => ({ ...defaultWidgetLayout(), desktop: initialWidgetProfile('desktop'), mobile: initialWidgetProfile('mobile') });
async function ready(page, env) { await page.goto(env.base); await expect(page.locator('#settings-status')).toHaveText('General settings use Global shared values.'); }
async function enter(page) { await page.locator('#edit-layout').click(); await expect(page.locator('#layout-toolbar')).toBeVisible(); await expect(page.locator('#layout-details')).toBeHidden(); }
async function details(page) { await page.locator('#layout-toggle').click(); await expect(page.locator('#layout-details')).toBeVisible(); }
async function open(page) { await enter(page); await details(page); }
async function save(page) { await page.locator('#layout-save').click(); await expect(page.locator('#layout-toolbar')).toBeHidden(); }
async function pixel(page, key, value) { await page.locator(`#layout-${key}`).fill(String(value)); await page.locator(`#layout-${key}`).press('Tab'); }
const storedLayout = env => env.store.getDashboardPreferences().preferences.widgetLayout;

test('Custom fullscreen hiding and forecast toggles retain both profile geometries and layers', async ({ page }) => {
  const widgetLayout = layout(); const env = await environment({ widgetLayout });
  try {
    await page.clock.install({ time: new Date('2026-10-11T12:00:00Z') });
    const location = { label: 'London', latitude: 51, longitude: 0 }; env.store.saveWeatherLocation(location, 0);
    await page.route('**/api/weather?*', route => route.fulfill({ json: { configured: true, revision: 1, location, timezone: 'UTC', forecastRegistered: true, forecast: normalizeForecast(rawForecast()), air: { aqi: 20 }, forecastUpdated: Date.parse('2026-10-11T12:00:00Z'), airUpdated: Date.parse('2026-10-11T12:00:00Z'), forecastError: false, airError: false, refreshing: false } }));
    await page.route('**/api/weather/refresh', route => route.fulfill({ status: 202, json: { scheduled: false, refreshing: false } }));
    await ready(page, env); await expect(page.locator('#daily .forecast-item')).toHaveCount(7);
    for (const width of [1200, 600]) {
      await page.setViewportSize({ width, height: 900 }); await settleFrames(page);
      const mode = width <= 600 ? 'mobile' : 'desktop';
      await page.locator('#open-settings').click(); await page.locator('#settings-tab-general').click();
      await setPreferenceFlags(page, Object.fromEntries(['Time', 'Weather', 'Calendar', 'Bookmarks', 'HomeAssistant', 'Wol'].map(name => [`hide${name}Fullscreen`, true])));
      await page.locator('#settings-tab-weather').click();
      await page.locator('[name="weatherHourlyVisible"]').uncheck(); await page.locator('[name="weatherDailyVisible"]').uncheck();
      await saveCategory(page); await page.locator('#close-settings').click();
      await expect(page.locator('#forecast-details')).toBeHidden(); await expect(page.locator('#current-weather-values .temperature')).toHaveText('12 °C');
      await page.locator('#fullscreen').click(); await expect(page.locator('#widget-surface')).toBeHidden(); await expect(page.locator('#open-settings')).toBeVisible();
      expect(storedLayout(env)).toEqual(widgetLayout);
      await page.locator('#fullscreen').click(); await settleFrames(page);
      await assertProjectedBoxes(page, widgetLayout, mode);
      await page.locator('#open-settings').click(); await page.locator('#settings-tab-weather').click();
      await page.locator('[name="weatherHourlyVisible"]').check(); await page.locator('[name="weatherDailyVisible"]').check();
      await saveCategory(page); await page.locator('#close-settings').click();
      await expect(page.locator('#hourly')).toBeVisible(); await expect(page.locator('#daily')).toBeVisible();
      await settleFrames(page); await assertProjectedBoxes(page, widgetLayout, mode); expect(storedLayout(env)).toEqual(widgetLayout);
    }
  } finally { await page.goto('about:blank'); await env.close(); }
});

async function backgroundPoint(page, id = 'clock') { return page.locator(`#${id}`).evaluate(node => { const box = node.getBoundingClientRect(); return { x: box.x + 3, y: box.y + 3 }; }); }
// Only viewport measurement is controlled; CSS, DOM, observers, and the app remain real.
async function controlledViewport(page, screenSize = { width: 1600, height: 1000 }) {
  await page.addInitScript(size => {
    Object.defineProperty(screen, 'width', { configurable: true, value: size.width }); Object.defineProperty(screen, 'height', { configurable: true, value: size.height });
    const viewport = new EventTarget();
    Object.assign(viewport, { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  }, screenSize);
}
async function settleFrames(page, count = 14) {
  await page.evaluate(async count => { for (let i = 0; i < count; i++) await new Promise(resolve => requestAnimationFrame(resolve)); }, count);
}
async function canvasState(page) {
  return page.evaluate(async () => {
    const { measureLayoutSurface } = await import('/dashboard-layout-view.js');
    const stage = document.getElementById('widget-surface'); const rect = stage.getBoundingClientRect();
    const reference = { width: Number.parseFloat(stage.style.width), height: Number.parseFloat(stage.style.height) };
    const destination = measureLayoutSurface(document, window); const scale = Math.min(1, destination.width / reference.width, destination.height / reference.height);
    return { reference, source: stage.dataset.referenceSource, scale, actualScale: new DOMMatrix(getComputedStyle(stage).transform).a, actual: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, expected: { x: destination.x, y: destination.y + destination.height - reference.height * scale, width: reference.width * scale, height: reference.height * scale }, textHeight: document.getElementById('time').getBoundingClientRect().height / scale };
  });
}
function assertCanvasFit(state) {
  expect(state.actualScale).toBeCloseTo(state.scale, 5);
  for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(state.actual[key] - state.expected[key]), JSON.stringify(state)).toBeLessThanOrEqual(.1);
}
async function usableSurface(page, width, height) {
  const measured = await page.evaluate(async ({ width, height }) => {
    const { measureLayoutSurface } = await import('/dashboard-layout-view.js');
    const style = getComputedStyle(document.documentElement); const safe = edge => Number.parseFloat(style.getPropertyValue(`--layout-safe-${edge}`)) || 0;
    Object.assign(visualViewport, { width: width + safe('left') + safe('right'), height: height + safe('top') + safe('bottom') });
    visualViewport.dispatchEvent(new Event('resize'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return measureLayoutSurface(document, window);
  }, { width, height });
  expect({ width: measured.width, height: measured.height }, 'controlled usable surface').toEqual({ width, height });
}
function edgeLayout() {
  const widgetLayout = layout();
  for (const mode of ['desktop', 'mobile']) widgetLayout[mode].items = widgetLayout[mode].items.map((item, index) => ({ ...item, x: index % 2 ? 800000 : 0, y: index % 3 ? 800000 : 0, w: 200000, h: 200000 }));
  return widgetLayout;
}
async function assertProjectedBoxes(page, widgetLayout, mode, preview = false) {
  const boxes = await page.evaluate(async ({ widgetLayout, mode, preview }) => {
    const { projectWidget, WIDGET_ELEMENTS } = await import('/dashboard-layout.js');
    const { measureLayoutSurface } = await import('/dashboard-layout-view.js');
    const parent = document.getElementById('widget-surface');
    const surface = { width: Number.parseFloat(parent.style.width), height: Number.parseFloat(parent.style.height) };
    const area = parent.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(parent).transform).a;
    const destination = measureLayoutSurface(document, window);
    if (!preview && (area.x < destination.x - .1 || area.y < destination.y - .1 || area.right > destination.x + destination.width + .1 || area.bottom > destination.y + destination.height + .1)) throw new Error(`Canvas outside destination: ${JSON.stringify({ area: area.toJSON(), destination })}`);
    return widgetLayout[mode].items.map((item, index) => {
      const node = preview ? document.querySelector(`#layout-frames [data-widget="${item.id}"]`) : document.getElementById(WIDGET_ELEMENTS[item.id]);
      const rect = projectWidget(item, surface); const box = node.getBoundingClientRect();
      return { id: item.id, hidden: node.hidden, actual: { x: box.x, y: box.y, width: box.width, height: box.height }, expected: { x: area.x + rect.x * scale, y: area.bottom - (rect.y + rect.h) * scale, width: rect.w * scale, height: rect.h * scale }, area: area.toJSON(), layer: node.style.zIndex, expectedLayer: String(index + 1) };
    });
  }, { widgetLayout, mode, preview });
  for (const box of boxes) {
    const context = JSON.stringify({ preview, mode, ...box });
    expect(box.layer, context).toBe(box.expectedLayer);
    if (box.hidden) { expect(box.actual.width, context).toBe(0); expect(box.actual.height, context).toBe(0); continue; }
    for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(box.actual[key] - box.expected[key]), `${key}: ${context}`).toBeLessThanOrEqual(.1);
    expect(box.actual.x, context).toBeGreaterThanOrEqual(box.area.x - .1);
    expect(box.actual.y, context).toBeGreaterThanOrEqual(box.area.y - .1);
    expect(box.actual.x + box.actual.width, context).toBeLessThanOrEqual(box.area.right + .1);
    expect(box.actual.y + box.actual.height, context).toBeLessThanOrEqual(box.area.bottom + .1);
  }
  return boxes;
}
async function drag(page, action, id, dx, dy, cancel = false) {
  const button = page.locator(`[data-widget="${id}"] [data-action="${action}"]`);
  await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
  const x = box.x + (action === 'move' ? Math.min(5, box.width / 4) : box.width / 2);
  const y = box.y + (action === 'move' ? Math.min(5, box.height / 4) : box.height / 2);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

test('widgets reach the fullscreen top edge beneath clickable Save, Toolbar and Cancel overlays', async ({ page }) => {
  const widgetLayout = layout(); const time = widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]; time.x = 100000; time.y = 100000; widgetLayout.desktop.items.push(time);
  const env = await environment({ widgetLayout, imageInfo: true }); const writes = [];
  try {
    await ready(page, env); await page.evaluate(() => document.documentElement.requestFullscreen()); await settleFrames(page);
    await page.evaluate(() => { document.getElementById('page-status').textContent = 'Status overlay'; document.getElementById('photo-caption').textContent = 'Caption overlay'; }); await settleFrames(page);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight })); const canvas = await canvasState(page);
    expect(canvas.actual).toEqual({ x: 0, y: 0, ...viewport }); expect(canvas.actualScale).toBe(1); await expect(page.locator('#edit-layout')).toBeHidden();
    const original = env.store.getDashboardPreferences(); page.on('request', request => { if (request.method() === 'PUT') writes.push(request.postDataJSON()); });
    const point = await backgroundPoint(page); await page.mouse.move(point.x, point.y); await page.mouse.down(); try { await expect(page.locator('#layout-toolbar')).toBeVisible(); } finally { await page.mouse.up(); }
    const handle = page.locator('[data-widget=time] [data-action=move]'); const start = await handle.boundingBox();
    await page.mouse.move(start.x + 4, start.y + 4); await page.mouse.down(); await page.mouse.move(viewport.width - 1, 0, { steps: 5 }); await page.mouse.up();
    const card = await page.locator('#clock').boundingBox(); const frame = await page.locator('[data-widget=time]').boundingBox(); expect(card.y).toBe(0); expect(card.x + card.width).toBe(viewport.width); expect(frame).toEqual(card);
    for (const id of ['save', 'toggle', 'cancel']) {
      const control = page.locator(`#layout-${id}`); const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(card.x); expect(box.y).toBeGreaterThanOrEqual(card.y);
      expect(await control.evaluate(node => { const box = node.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === node; })).toBe(true);
    }
    expect(writes).toEqual([]); expect(env.store.getDashboardPreferences()).toEqual(original);
    await details(page); await page.locator('#layout-close').click(); await save(page);
    expect(writes).toHaveLength(1); const saved = storedLayout(env).desktop.items.at(-1); const projected = projectWidget(saved, viewport); expect(projected.y + projected.h).toBe(viewport.height); expect(projected.x + projected.w).toBe(viewport.width); expect(saved.w).toBe(time.w); expect(saved.h).toBe(time.h); expect(storedLayout(env).mobile).toEqual(original.preferences.widgetLayout.mobile);
    expect(storedLayout(env).desktop.items.slice(0, -1)).toEqual(original.preferences.widgetLayout.desktop.items.slice(0, -1));
    await expect(page.locator('#clock')).not.toHaveAttribute('inert'); expect((await page.locator('#clock').boundingBox()).y).toBe(0);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('unchanged Custom editing retains normal canvas, widget and text dimensions', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() });
  try {
    await ready(page, env); await settleFrames(page);
    const original = env.store.getDashboardPreferences(); let writes = 0;
    page.on('request', request => { if (request.method() === 'PUT') writes++; });
    const sample = () => page.evaluate(() => ({ transform: document.getElementById('widget-surface').style.transform, reference: [document.getElementById('widget-surface').style.width, document.getElementById('widget-surface').style.height], boxes: Object.fromEntries(['widget-surface', 'clock', 'weather', 'calendar', 'bookmarks', 'dashboard-ha', 'dashboard-wol', 'time'].map(id => { const rect = document.getElementById(id).getBoundingClientRect(); return [id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]; })) }));
    for (const [width, height, fullscreen, safe = false] of [[1200, 800, false], [590, 800, false], [320, 480, false], [1200, 800, true], [1200, 800, false, true]]) {
      await page.setViewportSize({ width, height }); if (fullscreen) await page.evaluate(() => document.documentElement.requestFullscreen());
      if (safe) await page.evaluate(() => { for (const [edge, value] of Object.entries({ left: 10, right: 12, top: 4, bottom: 8 })) document.documentElement.style.setProperty(`--layout-safe-${edge}`, `${value}px`); });
      await page.evaluate(() => { document.getElementById('photo-caption').textContent = 'Fixture caption'; window.dispatchEvent(new Event('resize')); }); await settleFrames(page);
      const before = await sample();
      if (fullscreen) {
        await expect(page.locator('#edit-layout')).toBeHidden(); const point = await backgroundPoint(page);
        await page.mouse.move(point.x, point.y); await page.mouse.down();
        try { await expect(page.locator('#layout-toolbar')).toBeVisible(); } finally { await page.mouse.up(); }
        await expect(page.locator('#layout-details')).toBeHidden();
      } else await enter(page);
      await settleFrames(page); expect(await sample()).toEqual(before);
      const actions = await page.locator('#layout-form > header').boundingBox(); const vp = await page.evaluate(() => ({ width: visualViewport?.width ?? innerWidth, x: visualViewport?.offsetLeft || 0, y: visualViewport?.offsetTop || 0 })); expect(Math.abs(actions.x + actions.width - vp.x - vp.width + 8 + (safe ? 12 : 0))).toBeLessThanOrEqual(.1); expect(actions.y).toBe(vp.y + 8 + (safe ? 4 : 0));
      await details(page); await settleFrames(page); expect(await sample()).toEqual(before);
      await page.locator('#layout-toggle').click(); await settleFrames(page); expect(await sample()).toEqual(before);
      await page.locator('#layout-cancel').click(); await settleFrames(page); expect(await sample()).toEqual(before);
      if (fullscreen) await page.evaluate(() => document.exitFullscreen());
    }
    expect(writes).toBe(0); expect(env.store.getDashboardPreferences()).toEqual(original);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('panel dismissal preserves raw values, keyboard focus and scroll without committing or rebasing', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() }); let writes = 0;
  try {
    await page.clock.install(); await ready(page, env); page.on('request', request => { if (request.method() === 'PUT') writes++; });
    await enter(page); await expect(page.locator('#layout-toggle')).toBeFocused(); await page.keyboard.press('Space'); await expect(page.locator('#layout-details')).toBeFocused();
    const before = await page.locator('#clock').evaluate(node => node.style.width);
    for (const value of ['00181', '', '1.5', '0']) {
      await page.locator('#layout-w').fill(value); await page.locator('#layout-close').click(); await expect(page.locator('#layout-details')).toBeHidden(); await expect(page.locator('#layout-toggle')).toBeFocused();
      await page.clock.fastForward(5000); await details(page); await expect(page.locator('#layout-w')).toHaveValue(value); expect(await page.locator('#clock').evaluate(node => node.style.width)).toBe(before);
      await page.locator('#layout-w').focus(); await page.keyboard.press('Escape'); await expect(page.locator('#layout-details')).toBeHidden(); await expect(page.locator('#layout-toggle')).toBeFocused(); await details(page);
    }
    await page.locator('#layout-w').fill(''); await page.locator('#layout-toggle').click(); await page.locator('#layout-save').click(); await expect(page.locator('#layout-details')).toBeVisible(); await expect(page.locator('#layout-w')).toBeFocused();
    await page.keyboard.press('Escape'); await details(page); await expect(page.locator('#layout-w')).toHaveValue('');
    await page.locator('#layout-details').evaluate(node => { node.scrollTop = 100; }); const scroll = await page.locator('#layout-details').evaluate(node => node.scrollTop);
    await page.locator('#layout-toggle').click(); await details(page); expect(await page.locator('#layout-details').evaluate(node => node.scrollTop)).toBe(scroll);
    await page.locator('#layout-cancel').click(); expect(writes).toBe(0); expect(env.store.getDashboardPreferences().revision).toBe(1);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('panel toggles retain closed-panel direct manipulation and its fixed capture/fit', async ({ page }) => {
  const widgetLayout = layout(); const time = widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]; time.y = 100000; widgetLayout.desktop.items.push(time);
  const env = await environment({ widgetLayout });
  try {
    await ready(page, env); await enter(page); const before = env.store.getDashboardPreferences(); const frame = await canvasState(page);
    const handle = page.locator('[data-widget=time] [data-action=move]'); const box = await handle.boundingBox(); const point = { x: box.x + 3, y: box.y + 3 };
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 15, point.y - 10);
    await page.locator('#layout-toggle').focus(); await page.keyboard.press('Space'); await expect(page.locator('#layout-details')).toBeVisible(); await expect(page.locator('#layout-w')).toBeDisabled();
    expect((await canvasState(page)).actualScale).toBe(frame.actualScale);
    await page.locator('#layout-toggle').dispatchEvent('click'); await expect(page.locator('#layout-details')).toBeHidden(); await page.mouse.move(point.x + 30, point.y - 10); await page.mouse.up();
    await expect(page.locator('#layout-details')).toBeHidden(); await save(page);
    const moved = storedLayout(env).desktop.items.at(-1); expect(moved.x).toBeGreaterThan(time.x); expect(moved.y).toBeGreaterThan(time.y); expect(moved.w).toBe(time.w); expect(moved.h).toBe(time.h); expect(storedLayout(env).mobile).toEqual(before.preferences.widgetLayout.mobile);
    await enter(page); await drag(page, 'resize', 'time', 10, -10, true); await save(page); expect(storedLayout(env).desktop.items.at(-1)).toEqual(moved);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('all six widget rows and inline Up/Down controls reorder only their target profile', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env); await open(page); const original = env.store.getDashboardPreferences();
    const geometry = items => [...items].sort((a, b) => a.id.localeCompare(b.id));
    for (const mode of ['desktop', 'mobile']) {
      await page.locator('#layout-profile').selectOption(mode);
      const ids = original.preferences.widgetLayout[mode].items.map(item => item.id);
      for (const id of ids) {
        const row = page.locator(`[data-layer-row="${id}"]`); const up = row.locator('[data-layer=forward]'); const down = row.locator('[data-layer=backward]');
        const boundaryUp = id === ids.at(-1); const boundaryDown = id === ids[0]; await expect(up).toBeEnabled({ enabled: !boundaryUp }); await expect(down).toBeEnabled({ enabled: !boundaryDown });
        const first = boundaryUp ? down : up; const inverse = boundaryUp ? up : down;
        await first.click(); await expect(page.locator('#layout-widget')).toHaveValue(id); await inverse.focus(); await page.keyboard.press('Enter');
      }
    }
    await page.locator('#layout-profile').selectOption('desktop'); await page.locator('#layout-toggle').click();
    const inline = page.locator('[data-widget=time] .layout-frame-layers [data-layer=forward]'); await expect(inline).toBeVisible();
    await inline.click(); await expect(page.locator('#layout-details')).toBeHidden(); await save(page);
    const result = storedLayout(env); const ids = original.preferences.widgetLayout.desktop.items.map(item => item.id); const index = ids.indexOf('time'); [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    expect(result.desktop.items.map(item => item.id)).toEqual(ids); expect(geometry(result.desktop.items)).toEqual(geometry(original.preferences.widgetLayout.desktop.items)); expect(result.mobile).toEqual(original.preferences.widgetLayout.mobile);
    await env.restart(); await ready(page, env); expect(storedLayout(env)).toEqual(result);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('touch toolbar and per-widget layer taps preserve Automatic no-ops and require explicit Save', async ({ browser }) => {
  const env = await environment(); const context = await browser.newContext({ hasTouch: true, viewport: { width: 1100, height: 800 } }); const page = await context.newPage(); let writes = 0;
  try {
    await ready(page, env); page.on('request', request => { if (request.method() === 'PUT') writes++; }); await enter(page);
    const boundary = page.locator('[data-widget=calendar] [data-layer=backward]'); await expect(boundary).toBeDisabled(); await boundary.dispatchEvent('click'); await expect(page.locator('#layout-arrangement')).toHaveValue('automatic');
    const up = page.locator('[data-widget=time] [data-layer=forward]'); await up.tap(); await expect(page.locator('#layout-arrangement')).toHaveValue('custom'); await expect(page.locator('#clock')).toHaveCSS('z-index', '3'); await expect(page.locator('#layout-details')).toBeHidden();
    await page.locator('#layout-toggle').tap(); await expect(page.locator('#layout-details')).toBeVisible(); await page.locator('[data-layer-row=time] [data-layer=backward]').tap(); await expect(page.locator('#clock')).toHaveCSS('z-index', '2');
    await page.locator('#layout-reset').tap(); await expect(page.locator('#layout-arrangement')).toHaveValue('automatic'); await page.locator('#layout-close').tap(); await expect(page.locator('#layout-details')).toBeHidden(); await save(page);
    expect(writes).toBe(0); expect(env.store.getDashboardPreferences().revision).toBe(1);
  } finally { await context.close(); await env.close(); }
});

test('hidden, fully covered and zero-canvas widgets retain independent panel layer access', async ({ page }) => {
  const widgetLayout = layout(); widgetLayout.desktop.items = widgetLayout.desktop.items.map(item => ({ ...item, x: 0, y: 0, w: 1000000, h: 1000000 }));
  const env = await environment({ widgetLayout, timeVisible: false });
  try {
    await ready(page, env); await open(page); const before = env.store.getDashboardPreferences();
    await expect(page.locator('[data-layer-row=time]')).toContainText('hidden'); await page.locator('[data-layer-row=time] [data-layer=forward]').click(); await expect(page.locator('#layout-widget')).toHaveValue('time'); await expect(page.locator('#clock')).toBeHidden();
    await page.locator('#layout-cancel').click();
    const screenSize = await page.evaluate(() => ({ width: screen.width, height: screen.height }));
    await page.evaluate(() => { document.documentElement.style.setProperty('--layout-safe-left', '2px'); Object.defineProperty(screen, 'width', { configurable: true, value: 1 }); Object.defineProperty(screen, 'height', { configurable: true, value: 2 }); window.dispatchEvent(new Event('resize')); }); await settleFrames(page);
    await open(page); await expect(page.locator('#layout-frames')).toBeHidden(); await expect(page.locator('#widget-surface')).toBeHidden(); await expect(page.locator('#layout-w')).toBeDisabled();
    await page.locator('[data-layer-row=calendar] [data-layer=forward]').click(); await expect(page.locator('#layout-widget')).toHaveValue('calendar'); await expect(page.locator('#layout-cancel')).toBeInViewport();
    await page.locator('#layout-cancel').click(); expect(env.store.getDashboardPreferences()).toEqual(before);
    await page.evaluate(size => { document.documentElement.style.removeProperty('--layout-safe-left'); for (const [key, value] of Object.entries(size)) Object.defineProperty(screen, key, { configurable: true, value }); window.dispatchEvent(new Event('resize')); }, screenSize); await settleFrames(page); await expect(page.locator('#widget-surface')).toBeVisible();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('mouse hold enters Automatic editing only after threshold and consumes release without writes', async ({ page }) => {
  const env = await environment(); const writes = [];
  try {
    await page.clock.install(); await ready(page, env); page.on('request', request => { if (request.method() === 'PUT') writes.push(request.url()); });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const original = env.store.getDashboardPreferences(); const point = await backgroundPoint(page);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.clock.runFor(599); await expect(page.locator('#layout-toolbar')).toBeHidden();
    await page.clock.runFor(1); await expect(page.locator('#layout-toolbar')).toBeVisible(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
    await expect(page.locator('#layout-widget')).toHaveValue('time'); await expect(page.locator('#layout-arrangement')).toHaveValue('automatic'); await expect(page.locator('#layout-status')).toContainText('temporary template');
    // Reposition Save under the held pointer: release must not click through new chrome.
    await page.locator('#layout-save').evaluate((node, point) => { node.setAttribute('form', 'layout-form'); document.body.append(node); Object.assign(node.style, { position: 'fixed', zIndex: '100', left: `${point.x - 20}px`, top: `${point.y - 15}px` }); }, point);
    expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.id, point)).toBe('layout-save');
    await page.mouse.up(); await expect(page.locator('#layout-toolbar')).toBeVisible(); await expect(page.locator('#open-settings')).toBeDisabled();
    await page.locator('#layout-save').evaluate(node => { document.querySelector('#layout-form header').prepend(node); node.removeAttribute('form'); node.removeAttribute('style'); });
    await details(page); await page.locator('#layout-profile').selectOption('mobile'); await page.locator('#layout-widget').selectOption('wol'); await save(page);
    expect(writes).toEqual([]); expect(env.store.getDashboardPreferences()).toEqual(original);
    await expect(page.locator('#clock')).not.toHaveAttribute('inert'); expect(await page.evaluate(() => ['clock', 'edit-layout'].includes(document.activeElement.id))).toBe(true); await expect(page.locator('#clock')).not.toHaveAttribute('tabindex');
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('trusted short clicks, moved holds, nested scrolling and interactive descendants do not enter editing', async ({ page }) => {
  const env = await environment();
  try {
    await page.clock.install(); await ready(page, env);
    await page.locator('#clock').evaluate(node => { const button = document.createElement('button'); button.textContent = 'Fixture action'; button.onclick = () => window.fixtureClicks = (window.fixtureClicks || 0) + 1; node.append(button); const link = document.createElement('a'); link.href = '#fixture'; link.textContent = 'Fixture link'; node.append(link); });
    let point = await backgroundPoint(page); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.clock.runFor(400); await page.mouse.up(); await page.clock.runFor(300);
    await expect(page.locator('#layout-toolbar')).toBeHidden();
    await page.mouse.down(); await page.mouse.move(point.x + 8, point.y); await page.clock.runFor(700); await page.mouse.up(); await expect(page.locator('#layout-toolbar')).toBeHidden();
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.locator('#clock').dispatchEvent('scroll'); await page.clock.runFor(700); await page.mouse.up(); await expect(page.locator('#layout-toolbar')).toBeHidden();
    for (const selector of ['#clock button', '#clock a']) { const box = await page.locator(selector).boundingBox(); await page.mouse.move(box.x + 3, box.y + 3); await page.mouse.down(); await page.clock.runFor(700); await page.mouse.up(); await expect(page.locator('#layout-toolbar')).toBeHidden(); }
    expect(await page.evaluate(() => window.fixtureClicks)).toBe(1);
    // An eligible hold suppresses only its own context menu.
    await page.evaluate(() => getSelection().removeAllRanges()); point = await backgroundPoint(page); await page.locator('#clock').dispatchEvent('pointerdown', { button: 0, isPrimary: true, pointerId: 91, clientX: point.x, clientY: point.y });
    expect(await page.locator('#clock').evaluate(node => !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
    expect(await page.locator('#clock a').evaluate(node => !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(false);
    await page.locator('#clock').dispatchEvent('pointerup', { pointerId: 91 });
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('actual touch hold enters direct editing; native scrolling, early release and two touches cancel activation', async ({ browser }) => {
  const env = await environment(); const context = await browser.newContext({ hasTouch: true, viewport: { width: 1100, height: 800 } }); const page = await context.newPage();
  try {
    await page.clock.install(); await ready(page, env); const cdp = await context.newCDPSession(page); const point = await backgroundPoint(page);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await touch('touchStart', [point]); await page.clock.runFor(300); await touch('touchEnd', []); await page.clock.runFor(400); await expect(page.locator('#layout-toolbar')).toBeHidden();
    await touch('touchStart', [point]); await touch('touchMove', [{ x: point.x + 20, y: point.y + 20 }]); await page.clock.runFor(700); await touch('touchEnd', []); await expect(page.locator('#layout-toolbar')).toBeHidden();
    await touch('touchStart', [{ ...point, id: 1 }]); await touch('touchStart', [{ ...point, id: 1 }, { x: point.x + 30, y: point.y + 30, id: 2 }]); await page.clock.runFor(700); await touch('touchEnd', []); await expect(page.locator('#layout-toolbar')).toBeHidden();
    await touch('touchStart', [point]); await page.clock.runFor(650); await expect(page.locator('#layout-toolbar')).toBeVisible(); await touch('touchEnd', []);
    await expect(page.locator('#layout-widget')).toHaveValue('time'); await page.locator('#layout-cancel').click();
    // Native touch scrolling is not disabled on ordinary widget content.
    await page.locator('#clock').evaluate(node => { node.style.height = '130px'; node.style.overflow = 'auto'; const content = document.createElement('p'); content.textContent = 'Scrollable fixture '.repeat(150); node.append(content); });
    const box = await page.locator('#clock').boundingBox(); const scrollPoint = { x: box.x + box.width / 2, y: box.y + 100 };
    await touch('touchStart', [scrollPoint]); await touch('touchMove', [{ x: scrollPoint.x, y: scrollPoint.y - 70 }]); await touch('touchEnd', []); await page.clock.runFor(700);
    await expect(page.locator('#layout-toolbar')).toBeHidden(); await expect.poll(() => page.locator('#clock').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  } finally { await context.close(); await env.close(); }
});

test('polls preserve focused raw fields and captured gestures across unchanged, failed and remote snapshots', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() }); const writes = [];
  try {
    await page.clock.install(); await ready(page, env); await open(page); const base = env.store.getDashboardPreferences();
    page.on('request', request => { if (request.method() === 'PUT') writes.push(request.postDataJSON()); });
    await page.locator('#layout-w').fill('181'); await page.clock.fastForward(5000); await expect(page.locator('#layout-w')).toBeFocused(); await expect(page.locator('#layout-w')).toHaveValue('181');
    await page.locator('#layout-w').fill(''); await page.clock.fastForward(5000); await expect(page.locator('#layout-w')).toHaveValue('');
    await page.route('**/api/dashboard/settings', route => route.request().method() === 'GET' ? route.abort() : route.continue()); await page.clock.fastForward(5000); await expect(page.locator('#layout-w')).toHaveValue(''); await expect(page.locator('#layout-w')).toBeFocused();
    await page.locator('#layout-save').click(); await expect(page.locator('#layout-w')).toBeFocused(); expect(writes).toEqual([]);
    await page.unroute('**/api/dashboard/settings'); await pixel(page, 'w', 181);
    const handle = page.locator('[data-widget="time"] [data-action="move"]'); const box = await handle.boundingBox(); const point = { x: box.x + 3, y: box.y + 3 };
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 10, point.y);
    await page.clock.fastForward(5000); await expect(page.locator('#layout-w')).toBeDisabled();
    const remote = env.store.getDashboardPreferences(); env.store.saveDashboardPreferences({ ...remote.preferences, color: '#112233' }, remote.revision);
    await page.clock.fastForward(5000); await expect(page.locator('#layout-w')).toBeDisabled(); await page.mouse.move(point.x + 20, point.y); await page.mouse.up();
    await expect(page.locator('#layout-w')).toHaveValue('181'); await page.locator('#layout-save').click(); await expect(page.locator('#layout-status')).toContainText('revision changed');
    expect(writes).toEqual([]); expect(env.store.getDashboardPreferences().revision).toBeGreaterThan(base.revision);
    await page.locator('#layout-cancel').click(); await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 34, 51)');
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('pending layout write blocks every exit and mutation until confirmed success or retained failure', async ({ page }) => {
  const env = await environment(); let release; const bodies = [];
  try {
    await ready(page, env); await open(page); await pixel(page, 'w', 177);
    await page.route('**/api/dashboard/settings', async route => { if (route.request().method() !== 'PUT') return route.continue(); bodies.push(route.request().postDataJSON()); await new Promise(resolve => { release = resolve; }); return route.fulfill({ status: 503, json: { error: 'Fixture write failed.' } }); });
    await page.locator('#layout-save').click(); await expect(page.locator('#layout-status')).toHaveText('Saving shared layout…');
    for (const id of ['cancel', 'save', 'reload', 'reset', 'fullscreen', 'profile', 'widget', 'arrangement', 'w', 'toggle', 'close']) await expect(page.locator(`#layout-${id}`)).toBeDisabled();
    await page.keyboard.press('Escape'); await page.locator('#open-settings').dispatchEvent('click'); await page.locator('#edit-layout').dispatchEvent('click'); await expect(page.locator('#layout-toolbar')).toBeVisible(); await expect(page.locator('#settings-dialog')).toBeHidden();
    release(); await expect(page.locator('#layout-status')).toHaveText('Fixture write failed.'); await expect(page.locator('#layout-w')).toHaveValue('177'); await expect(page.locator('#clock')).toHaveAttribute('inert', '');
    expect(bodies).toHaveLength(1); expect(env.store.getDashboardPreferences().revision).toBe(1);
    await page.unroute('**/api/dashboard/settings'); await save(page); expect(env.store.getDashboardPreferences().revision).toBe(2);
  } finally { release?.(); await page.goto('about:blank'); await env.close(); }
});

test('unrelated Settings clean refresh and dirty conflicts preserve complete remote layouts and credential drafts', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() }); const writes = [];
  try {
    await page.clock.install(); await ready(page, env); page.on('request', request => { if (request.method() === 'PUT') writes.push(request.postDataJSON()); });
    await page.locator('#open-settings').click(); await expect(page.locator('#settings-dialog #layout-profile')).toHaveCount(0); await expect(page.locator('#settings-dialog [role=tab]')).toHaveCount(8);
    const remote = env.store.getDashboardPreferences(); const changed = layout(); changed.desktop.items[0].x = 10000;
    env.store.saveDashboardPreferences({ ...remote.preferences, widgetLayout: changed }, remote.revision); await page.clock.fastForward(5000);
    // Opening Settings may still own an earlier GET; wait for the actual new confirmation before dirtying the form.
    await expect.poll(async () => { await page.clock.runFor(500); return page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.shared-settings.v1')).revision); }).toBe(2);
    await page.locator('#settings-tab-time').click(); await page.getByLabel('Clock scale', { exact: true }).fill('1.1'); await saveCategory(page);
    expect(writes[0].preferences.widgetLayout).toEqual(changed); expect(writes[0].revision).toBe(2);
    await page.getByLabel('Clock scale', { exact: true }).fill('1.2'); await page.locator('#settings-tab-home-assistant').click(); await page.locator('#home-assistant-url').fill('https://unsaved.test');
    const before = env.store.getDashboardPreferences(); const latest = layout(); latest.mobile = null; env.store.saveDashboardPreferences({ ...before.preferences, widgetLayout: latest }, before.revision); await page.clock.fastForward(5000);
    await page.locator('#settings-tab-time').click(); await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toContainText('revision changed');
    expect(writes).toHaveLength(1); expect(storedLayout(env)).toEqual(latest);
    await page.locator('#settings-tab-home-assistant').click(); await expect(page.locator('#home-assistant-url')).toHaveValue('https://unsaved.test'); await page.locator('#close-settings').click();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('keyboard/fullscreen entry, hidden placeholders, inactive profile and breakpoint transitions retain ownership', async ({ page }) => {
  const env = await environment({ timeVisible: false, widgetLayout: layout() });
  try {
    await ready(page, env); const original = env.store.getDashboardPreferences(); await page.locator('#edit-layout').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#layout-toggle')).toBeFocused(); await expect(page.locator('[data-widget=time] [data-action=move]')).toHaveText('Time (hidden)'); await expect(page.locator('#clock')).toBeHidden();
    for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => Boolean(document.activeElement.closest('#layout-toolbar, #layout-frames')) || document.activeElement === document.body)).toBe(true); }
    await details(page); await page.locator('#layout-profile').selectOption('mobile'); await expect(page.locator('#layout-status')).toContainText('inactive profile'); await pixel(page, 'w', 156);
    await page.setViewportSize({ width: 590, height: 800 }); await expect(page.locator('#layout-profile')).toHaveValue('mobile'); await expect(page.locator('#layout-w')).toHaveValue('156');
    await page.locator('#layout-cancel').click(); await expect(page.locator('#edit-layout')).toBeFocused(); expect(env.store.getDashboardPreferences()).toEqual(original);
    await open(page); await page.evaluate(() => document.documentElement.requestFullscreen()); await expect(page.locator('#edit-layout')).toBeHidden(); await expect(page.locator('#layout-cancel')).toBeInViewport(); await page.locator('#layout-fullscreen').click(); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false); await page.locator('#layout-cancel').click(); await expect(page.locator('#edit-layout')).toBeVisible();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('profile selection cancels a captured gesture and persisted-page suspension retains completed drafts without saves', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() }); const writes = [];
  try {
    await ready(page, env); await open(page); await pixel(page, 'w', 177); const before = env.store.getDashboardPreferences();
    page.on('request', request => { if (request.method() === 'PUT') writes.push(request.postDataJSON()); });
    const handle = page.locator('[data-widget=time] [data-action=move]'); let box = await handle.boundingBox();
    await page.mouse.move(box.x + 3, box.y + 3); await page.mouse.down(); await page.mouse.move(box.x + 25, box.y + 3);
    await page.locator('#layout-profile').selectOption('mobile'); await page.mouse.up(); await expect(page.locator('#layout-profile')).toHaveValue('mobile');
    await page.locator('#layout-profile').selectOption('desktop'); await expect(page.locator('#layout-w')).toHaveValue('177');
    const x = await page.locator('#layout-x').inputValue(); const reference = (await canvasState(page)).reference;
    box = await handle.boundingBox(); await page.mouse.move(box.x + 3, box.y + 3); await page.mouse.down(); await page.mouse.move(box.x + 18, box.y + 3);
    // Synthetic lifecycle exercises the persisted branch, not a claim that BFCache is guaranteed.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await page.mouse.up();
    await expect(page.locator('#layout-x')).toHaveValue(x); await expect(page.locator('#layout-toolbar')).toBeVisible(); await expect(page.locator('#clock')).toHaveAttribute('inert', '');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await settleFrames(page);
    await expect(page.locator('#layout-w')).toHaveValue('177'); expect((await canvasState(page)).reference).toEqual(reference); expect(writes).toEqual([]); expect(env.store.getDashboardPreferences()).toEqual(before);
    await page.locator('#layout-cancel').click();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('short native windows retain reachable Save and Cancel above a safely deferred editing canvas', async ({ page }) => {
  const env = await environment();
  try {
    await ready(page, env); const before = env.store.getDashboardPreferences();
    for (const [width, height] of [[320, 240], [160, 150]]) {
      await page.setViewportSize({ width, height }); await open(page);
      for (const id of ['save', 'toggle', 'cancel']) { const box = await page.locator(`#layout-${id}`).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(width - 8 + .1); expect(box.y + box.height).toBeLessThanOrEqual(height - 8); }
      await expect(page.locator('#layout-save')).toBeInViewport(); await page.locator('#layout-cancel').scrollIntoViewIfNeeded(); await expect(page.locator('#layout-cancel')).toBeInViewport(); await page.locator('#layout-cancel').click();
    }
    expect(env.store.getDashboardPreferences()).toEqual(before);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('editor DOM lifecycle restores prior inert state and one reference lock; late saves cannot reopen disposed chrome', async ({ page }) => {
  const env = await environment();
  try {
    // Exercise the editor owner against real browser DOM without the application coordinator.
    await page.route('**/dashboard.js', route => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto(env.base);
    await page.evaluate(async () => {
      const { createDashboardLayoutEditor } = await import('/dashboard-layout-editor.js'); const { normalizeDashboardPreferences } = await import('/dashboard-helpers.js');
      window.editorFixture = { state: { confirmed: true, snapshot: { preferences: normalizeDashboardPreferences(), revision: 3 } }, locks: 0, releases: 0, projections: 0, writes: [], override: null };
      const f = window.editorFixture; document.getElementById('clock').inert = true;
      f.editor = createDashboardLayoutEditor({ document, window, view: { reference: () => ({ width: 1000, height: 800 }), frame: () => ({ reference: { width: 1000, height: 800 }, fit: { x: 0, y: 400, scale: .5 } }), lockReference: () => f.locks++, releaseReference: () => f.releases++, setOverride: value => { f.override = value; f.projections++; } }, getState: () => f.state, activeProfile: () => 'desktop', canEnter: () => true, toggleFullscreen() {}, save: (preferences, revision) => { f.writes.push({ preferences, revision }); return new Promise(resolve => { f.resolve = resolve; }); } });
      f.editor.enter(); f.editor.enter('weather');
    });
    const projections = await page.evaluate(() => window.editorFixture.projections);
    await details(page); await page.locator('#layout-toggle').click(); await details(page); expect(await page.evaluate(() => window.editorFixture.projections)).toBe(projections);
    await expect(page.locator('#layout-widget')).toHaveValue('weather'); await pixel(page, 'w', 177);
    await page.evaluate(() => { const f = window.editorFixture; f.state.snapshot = { revision: 5, preferences: { ...f.state.snapshot.preferences, color: '#123456' } }; f.editor.observe(); f.editor.refreshSurface(); });
    await expect(page.locator('#layout-w')).toHaveValue('177'); await page.locator('#layout-save').click();
    expect(await page.evaluate(() => { const f = window.editorFixture; return { locks: f.locks, revision: f.writes[0].revision, keys: Object.keys(f.writes[0].preferences) }; })).toEqual({ locks: 1, revision: 3, keys: ['widgetLayout'] });
    await page.evaluate(() => { const f = window.editorFixture; f.editor.dispose(); f.editor.dispose(); f.resolve(); });
    await expect(page.locator('#layout-toolbar')).toBeHidden(); await expect(page.locator('#layout-frames')).toBeHidden(); await expect(page.locator('#clock')).toHaveAttribute('inert', ''); await expect(page.locator('#weather')).not.toHaveAttribute('inert');
    await page.locator('#layout-toggle').dispatchEvent('click'); await expect(page.locator('#layout-details')).toBeHidden(); await expect(page.locator('#layout-toggle')).toHaveAttribute('aria-expanded', 'false'); await expect(page.locator('[data-layer-row]')).toHaveCount(0);
    expect(await page.evaluate(() => ({ releases: window.editorFixture.releases, override: window.editorFixture.override, active: window.editorFixture.editor.active, enter: window.editorFixture.editor.enter() }))).toEqual({ releases: 1, override: null, active: false, enter: false });
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('offline edit base stays nonwritable after confirmation until explicit reload discards both profiles', async ({ page }) => {
  const env = await environment();
  try {
    await page.clock.install(); await ready(page, env); await page.route('**/api/dashboard/settings', route => route.abort()); await page.reload(); await expect(page.locator('#settings-status')).not.toHaveText('Loading shared preferences…'); await open(page);
    await pixel(page, 'w', 177); await page.locator('#layout-profile').selectOption('mobile'); await pixel(page, 'w', 155); await expect(page.locator('#layout-save')).toBeDisabled();
    await page.unroute('**/api/dashboard/settings'); await page.clock.fastForward(5000); await expect(page.locator('#layout-reload')).toBeEnabled(); await expect(page.locator('#layout-save')).toBeDisabled(); await expect(page.locator('#layout-w')).toHaveValue('155');
    await page.locator('#layout-reload').click(); await expect(page.locator('#layout-arrangement')).toHaveValue('automatic'); await page.locator('#layout-profile').selectOption('desktop'); await expect(page.locator('#layout-arrangement')).toHaveValue('automatic'); await expect(page.locator('#layout-save')).toBeEnabled();
    await save(page); expect(env.store.getDashboardPreferences().revision).toBe(1);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('all actionable descendant selectors and composed shadow controls exclude long press in real DOM', async ({ page }) => {
  const env = await environment();
  try {
    await page.clock.install(); await ready(page, env); await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const result = await page.evaluate(async () => {
      const { createLayoutActivation } = await import('/dashboard-layout-activation.js'); const timers = new Map(); let sequence = 0; let activations = 0;
      const controller = createLayoutActivation({ document, window, canEnter: () => true, activate: () => { activations++; return true; }, schedule(fn) { timers.set(++sequence, fn); return sequence; }, cancel: id => timers.delete(id) });
      const root = document.getElementById('clock'); const markup = ['<a href="#">link</a>', '<button>button</button>', '<input>', '<select></select>', '<textarea></textarea>', '<label>label</label>', '<summary>summary</summary>', '<iframe></iframe>', '<object></object>', '<embed>', '<audio></audio>', '<video></video>', '<span tabindex="-1">focus</span>', '<span draggable="true">drag</span>', '<span contenteditable="true">edit</span>', ...['button', 'link', 'checkbox', 'switch', 'menuitem', 'option', 'tab', 'treeitem', 'slider', 'spinbutton', 'combobox', 'listbox', 'textbox', 'searchbox', 'radio'].map(role => `<span role="${role}">${role}</span>`)];
      for (const html of markup) { const wrapper = document.createElement('div'); wrapper.innerHTML = html; root.append(wrapper); wrapper.firstElementChild.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, isPrimary: true, pointerId: 41 })); wrapper.remove(); }
      const host = document.createElement('div'); root.append(host); const shadow = host.attachShadow({ mode: 'open' }); shadow.innerHTML = '<button>Shadow control</button>'; shadow.firstElementChild.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, isPrimary: true, pointerId: 41 })); host.remove();
      const remaining = timers.size; controller.dispose(); return { remaining, activations, checked: markup.length + 1 };
    });
    expect(result).toEqual({ remaining: 0, activations: 0, checked: 31 }); await expect(page.locator('#layout-toolbar')).toBeHidden();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('custom arrangement saves geometry/layers and reset/cancel preserve independent drafts', async ({ page }) => {
  const env = await environment();
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env);
    await expect(page.locator('#widget-surface')).toBeHidden(); await open(page);
    await page.locator('#layout-arrangement').selectOption('custom'); await page.locator('#layout-widget').selectOption('time');
    await pixel(page, 'x', 20); await pixel(page, 'y', 30); await pixel(page, 'w', 210); await pixel(page, 'h', 130);
    await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
    await expect(page.locator('#widget-surface')).toBeVisible();
    await save(page);
    await expect(page.locator('#widget-surface')).toBeVisible(); await expect(page.locator('#clock')).toHaveCSS('z-index', '6');
    const first = structuredClone(storedLayout(env)); expect(first.mobile).toBeNull();
    const clock = await page.locator('#clock').evaluate(node => ({ width: node.style.width, height: node.style.height })); expect(clock).toEqual({ width: '210px', height: '130px' });
    await page.locator('#open-settings').click(); await page.locator('#settings-tab-time').click(); await page.getByLabel('Clock scale', { exact: true }).fill('1.2');
    await expect(page.locator('#edit-layout')).toBeDisabled(); await saveCategory(page); await page.locator('#close-settings').click(); await open(page);
    await page.locator('#layout-reset').click(); await page.locator('#layout-cancel').click();
    await page.locator('#open-settings').click(); await page.locator('#settings-tab-time').click(); await expect(page.getByLabel('Clock scale', { exact: true })).toHaveValue('1.2'); await page.locator('#close-settings').click();
    expect(storedLayout(env)).toEqual(first);
    await expect(page.locator('#clock')).toHaveCSS('font-size', '19.2px'); await expect(page.locator('#bookmarks')).toHaveCSS('font-size', '16px');
    await open(page); await page.locator('#layout-profile').selectOption('mobile'); await page.locator('#layout-arrangement').selectOption('custom'); await save(page);
    expect(storedLayout(env).desktop).toEqual(first.desktop); expect(storedLayout(env).mobile).not.toBeNull();
    await open(page); await page.locator('#layout-profile').selectOption('desktop'); await page.locator('#layout-reset').click(); await save(page);
    expect(storedLayout(env).desktop).toBeNull(); expect(storedLayout(env).mobile).not.toBeNull();
    await expect(page.locator('#widget-surface')).toBeHidden();
    await env.restart(); await ready(page, env); expect(storedLayout(env).mobile).not.toBeNull();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('covered widgets are selectable and all six share one hit-tested stacking surface', async ({ page }) => {
  const widgetLayout = layout(); widgetLayout.desktop.items = widgetLayout.desktop.items.map(item => ({ ...item, x: 100000, y: 100000, w: 500000, h: 500000 }));
  const env = await environment({ widgetLayout });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env); await open(page);
    for (const id of ['time', 'weather', 'calendar', 'bookmarks', 'home-assistant', 'wol']) {
      await page.locator('#layout-widget').selectOption(id); const front = page.getByRole('button', { name: 'Bring to front', exact: true }); if (await front.isEnabled()) await front.click(); await save(page);
      const top = await page.evaluate(() => { const area = document.querySelector('#widget-surface > section').getBoundingClientRect(); return document.elementFromPoint(area.x + area.width * .2, area.y + area.height * .2)?.closest('#widget-surface > section, #widget-surface > aside')?.id; });
      expect(top).toBe({ time: 'clock', weather: 'weather', calendar: 'calendar', bookmarks: 'bookmarks', 'home-assistant': 'dashboard-ha', wol: 'dashboard-wol' }[id]);
      await expect(page.locator('#open-settings')).toBeVisible(); await open(page);
    }
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('minimum-clamped pointer moves and canceled/no-op edits retain canonical sizes across windows', async ({ browser }) => {
  const widgetLayout = layout(); widgetLayout.desktop.items = widgetLayout.desktop.items.map(item => item.id === 'time' ? { ...item, x: 100000, y: 100000, w: 100000, h: 100000 } : item); widgetLayout.desktop.items.push(widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]);
  const env = await environment({ widgetLayout }); const small = await browser.newPage({ viewport: { width: 832, height: 800 } }); const large = await browser.newPage({ viewport: { width: 1632, height: 1000 } });
  try {
    await controlledViewport(small, { width: 800, height: 800 }); await controlledViewport(large, { width: 1600, height: 1000 });
    await ready(small, env); await ready(large, env); await open(small); await small.locator('#layout-widget').selectOption('time');
    const original = structuredClone(storedLayout(env)); const rect = await large.locator('#clock').boundingBox(); expect(rect.width).toBe(160);
    expect(await small.locator('#clock').evaluate(node => node.style.width)).toBe('100px');
    await drag(small, 'move', 'time', 20, 10); await save(small);
    const saved = structuredClone(storedLayout(env)); const item = saved.desktop.items.find(item => item.id === 'time'); expect(item.w).toBe(100000); expect(item.h).toBe(100000);
    expect(saved.desktop.items.filter(item => item.id !== 'time')).toEqual(original.desktop.items.filter(item => item.id !== 'time'));
    await large.reload(); await expect(large.locator('#clock')).toHaveCSS('width', '160px');
    const revision = env.store.getDashboardPreferences().revision;
    await open(small); await drag(small, 'move', 'time', 15, 15, true); await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    await open(small); await drag(small, 'move', 'time', 0, 0); await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    await open(small);
    const handle = small.locator('[data-widget="time"] [data-action="move"]'); await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox();
    await small.mouse.move(box.x + 4, box.y + 4); await small.mouse.down(); await small.mouse.move(box.x + 14, box.y + 14); await small.mouse.move(box.x + 4, box.y + 4); await small.mouse.up();
    await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    await open(small); await handle.evaluate(node => node.addEventListener('pointerdown', event => { window.layoutCaptureId = event.pointerId; }, { once: true })); await small.mouse.move(box.x + 4, box.y + 4); await small.mouse.down(); await small.mouse.move(box.x + 14, box.y + 14);
    await handle.dispatchEvent('pointercancel', { pointerId: await small.evaluate(() => window.layoutCaptureId) }); await small.mouse.up(); await save(small); expect(env.store.getDashboardPreferences().revision).toBe(revision);
    await open(small); const x = await small.locator('#layout-x').inputValue(); await pixel(small, 'x', Number(x) + 1); await save(small);
    expect(storedLayout(env).desktop.items.find(item => item.id === 'time').w).toBe(100000);
    expect(storedLayout(env).mobile).toEqual(original.mobile);
  } finally { await small.close(); await large.close(); await env.close(); }
});

test('custom cards stay within each viewport without resize writes, including tiny surfaces and all-hidden editing', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() });
  try {
    await ready(page, env); const original = env.store.getDashboardPreferences(); let writes = 0;
    page.on('request', request => { if (request.url().endsWith('/api/dashboard/settings') && request.method() === 'PUT') writes++; });
    for (const [width, height] of [[320, 480], [600, 300], [601, 800], [1000, 500], [1200, 800], [160, 150]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => { const stage = document.getElementById('widget-surface'); const area = stage.getBoundingClientRect(); if (stage.hidden) return area.width === 0 && area.height === 0; const scale = new DOMMatrix(getComputedStyle(stage).transform).a; return [...document.querySelectorAll('#widget-surface > section, #widget-surface > aside')].every(node => { const box = node.getBoundingClientRect(); return box.width + .1 >= Math.min(100, Number.parseFloat(stage.style.width)) * scale && box.height + .1 >= Math.min(100, Number.parseFloat(stage.style.height)) * scale && box.x >= area.x - .1 && box.y >= area.y - .1 && box.right <= area.right + .1 && box.bottom <= area.bottom + .1; }); })).toBe(true);
    }
    expect(writes).toBe(0); expect(env.store.getDashboardPreferences()).toEqual(original);
    await page.setViewportSize({ width: 1200, height: 800 }); await page.locator('#open-settings').click();
    await setPreferenceFlags(page, Object.fromEntries(['time', 'weather', 'calendar', 'bookmarks', 'homeAssistant', 'wol'].map(name => [`${name}Visible`, false])));
    await page.locator('#close-settings').click(); await expect(page.locator('#widget-surface')).toBeHidden();
    await open(page); await expect(page.locator('#layout-w')).toBeEnabled(); await expect(page.locator('#layout-frames')).toBeVisible();
    await page.locator('#layout-cancel').click(); await page.locator('#fullscreen').click(); await expect(page.locator('#open-settings')).toBeVisible(); await expect(page.locator('#edit-layout')).toBeHidden(); await page.locator('#fullscreen').click();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('remote layout conflicts preserve dirty geometry; failed writes retain only a local preview', async ({ browser }) => {
  const env = await environment({ widgetLayout: layout() }); const a = await browser.newPage(); const b = await browser.newPage();
  try {
    await b.clock.install(); await ready(a, env); await ready(b, env); await open(a); await open(b);
    await pixel(b, 'w', 170);
    await pixel(a, 'w', 240); await save(a); await b.clock.fastForward(5000);
    await expect(b.locator('#layout-w')).toHaveValue('170');
    await b.locator('#layout-save').click(); await expect(b.locator('#layout-status')).toContainText('revision changed');
    await expect(b.locator('#layout-w')).toHaveValue('170');
    await b.locator('#layout-reload').click(); await expect(b.locator('#layout-w')).toHaveValue('240');
    const saved = structuredClone(storedLayout(env));
    await b.route('**/api/dashboard/settings', route => route.request().method() === 'PUT' ? route.abort() : route.continue());
    await pixel(b, 'w', 200); await b.locator('#layout-save').click(); await expect(b.locator('#layout-status')).not.toHaveText('Saving shared layout…');
    await expect(b.locator('#layout-w')).toHaveValue('200'); expect(storedLayout(env)).toEqual(saved);
    await b.locator('#layout-cancel').click(); await b.locator('#open-settings').click(); await b.locator('#settings-tab-time').click(); await b.getByLabel('Timezone', { exact: true }).fill('Invalid/Zone');
    await open(a); await pixel(a, 'w', 250); await save(a); await b.clock.fastForward(5000);
    await expect(b.getByLabel('Timezone', { exact: true })).toHaveValue('Invalid/Zone');
    await b.locator('#settings-tab-home-assistant').click(); await b.locator('#home-assistant-url').fill('https://unsaved.test'); await b.clock.fastForward(5000); await expect(b.locator('#home-assistant-url')).toHaveValue('https://unsaved.test');
    await b.locator('#close-settings').click(); await open(b); await expect(b.locator('#layout-w')).toHaveValue('250');
  } finally { await a.close(); await b.close(); await env.close(); }
});

test('real resize gestures and keyboard fields edit only intended dimensions', async ({ page }) => {
  const widgetLayout = layout(); const time = widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]; time.y = 100000; time.h = 200000; widgetLayout.desktop.items.push(time);
  const env = await environment({ widgetLayout });
  try {
    await ready(page, env); await open(page); await page.locator('#layout-widget').selectOption('time');
    const original = structuredClone(storedLayout(env));
    await drag(page, 'resize', 'time', 10, -8); await save(page);
    const item = storedLayout(env).desktop.items.at(-1); expect(item.w).toBeGreaterThan(time.w); expect(item.h).toBeGreaterThan(time.h);
    expect(item.x).toBe(time.x); expect(item.y).toBe(time.y);
    await open(page); await page.locator('#layout-w').focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab'); await save(page);
    const resized = storedLayout(env).desktop.items.at(-1); expect(resized.h).toBe(item.h); expect(resized.w).toBeGreaterThan(item.w);
    expect(storedLayout(env).desktop.items.slice(0, -1)).toEqual(original.desktop.items.slice(0, -1));
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('touch direct gestures capture only editing affordances and cancel on viewport changes', async ({ browser }) => {
  const widgetLayout = layout(); const time = widgetLayout.desktop.items.splice(widgetLayout.desktop.items.findIndex(item => item.id === 'time'), 1)[0]; time.y = 300000; widgetLayout.desktop.items.push(time);
  const env = await environment({ widgetLayout }); const context = await browser.newContext({ hasTouch: true, viewport: { width: 1100, height: 800 } }); const page = await context.newPage();
  try {
    await ready(page, env); await open(page); await page.locator('#layout-widget').selectOption('time');
    const session = await context.newCDPSession(page); const handle = page.locator('[data-widget="time"] [data-action="move"]'); await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 15, y: point.y + 10 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await save(page);
    const saved = structuredClone(storedLayout(env)); expect(saved.desktop.items.at(-1).x).not.toBe(time.x); expect(saved.desktop.items.at(-1).w).toBe(time.w);
    await open(page); const next = await handle.boundingBox(); const point2 = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point2] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point2.x + 10, y: point2.y + 10 }] });
    await page.locator('#layout-frames').dispatchEvent('pointercancel', { pointerId: 9999 }); await expect(page.locator('#layout-w')).toBeDisabled();
    const referenceWidth = await page.locator('#widget-surface').evaluate(node => node.style.width);
    // Destination-only refitting cancels capture without changing the locked reference.
    await page.setViewportSize({ width: 650, height: 800 }); await expect(page.locator('#widget-surface')).toHaveCSS('width', referenceWidth); await expect(page.locator('#layout-w')).toBeEnabled(); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await save(page);
    expect(storedLayout(env)).toEqual(saved);
  } finally { await context.close(); await env.close(); }
});

test('100px cards retain scroll access and fullscreen fitting without changing saved geometry', async ({ page }) => {
  const widgetLayout = layout(); widgetLayout.desktop.items = widgetLayout.desktop.items.map(item => ({ ...item, w: 1, h: 1 }));
  const env = await environment({ widgetLayout });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env);
    for (const id of ['clock', 'weather', 'calendar', 'bookmarks', 'dashboard-ha', 'dashboard-wol']) {
      const box = await page.locator(`#${id}`).boundingBox(); expect(box.width).toBe(100); expect(box.height).toBe(100);
      await page.locator(`#${id}`).evaluate(node => { const content = document.createElement('p'); content.textContent = 'Long readable content '.repeat(80); const button = document.createElement('button'); button.textContent = 'Last content action'; node.append(content, button); });
      await page.locator(`#${id}`).getByRole('button', { name: 'Last content action' }).scrollIntoViewIfNeeded();
      expect(await page.locator(`#${id}`).evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    }
    await open(page); await page.locator('#layout-widget').selectOption('time');
     await pixel(page, 'w', await page.locator('#widget-surface').evaluate(node => Number.parseFloat(node.style.width))); await pixel(page, 'h', await page.locator('#widget-surface').evaluate(node => Number.parseFloat(node.style.height))); await save(page);
    const area = await page.locator('#widget-surface').boundingBox(); const max = await page.locator('#clock').boundingBox(); expect(max).toEqual(area);
    const before = env.store.getDashboardPreferences(); await page.locator('#fullscreen').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.evaluate(() => document.exitFullscreen()); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    expect(env.store.getDashboardPreferences()).toEqual(before);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('layout-only changes and caption callbacks retain clock/slideshow owners', async ({ page }) => {
  const env = await environment({ widgetLayout: layout(), imageInfo: true, interval: 5, order: 'name', animation: 'none' }); let manifests = 0;
  try {
    await page.clock.install(); await page.addInitScript(() => { window.layoutClockCalls = []; const original = window.setInterval; window.setInterval = (...args) => { const id = original(...args); window.layoutClockCalls.push({ id, delay: args[1] }); return id; }; });
    const slideshow = await mockSlideshow(page, [{ name: 'first.png', lastModified: 1, url: '/api/dashboard/photos/abcdefghijklmnop' }, { name: 'second.png', lastModified: 2, url: '/api/dashboard/photos/qrstuvwxyzabcdef' }], () => { manifests++; });
    await page.route('**/api/dashboard/photos/*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
    await ready(page, env); await expect(page.locator('#photo-caption')).toHaveText('first.png');
    const timers = await page.evaluate(() => window.layoutClockCalls); await open(page); await pixel(page, 'w', 180); await save(page);
    expect(await page.evaluate(() => window.layoutClockCalls)).toEqual(timers);
    const revision = env.store.getDashboardPreferences().revision;
    for (const caption of ['second.png', 'first.png', 'second.png']) { slideshow.select(caption === 'first.png' ? 0 : 1); await page.clock.fastForward(5000); await expect(page.locator('#photo-caption')).toHaveText(caption); expect(await page.evaluate(() => window.layoutClockCalls)).toEqual(timers); expect(manifests).toBeGreaterThan(1); expect(env.store.getDashboardPreferences().revision).toBe(revision); }
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('Firefox and Chromium share canonical layouts but fit their own viewport', async ({ browser }) => {
  const env = await environment(); const other = await firefox.launch(); const a = await browser.newPage({ viewport: { width: 1200, height: 800 } }); const b = await other.newPage({ viewport: { width: 800, height: 700 } });
  try {
    await b.clock.install(); await ready(a, env); await ready(b, env); await open(a); await a.locator('#layout-arrangement').selectOption('custom'); await save(a);
    await b.clock.fastForward(5000); await expect(b.locator('#widget-surface')).toBeVisible();
    const cache = await b.evaluate(() => JSON.parse(localStorage.getItem('dashboard.shared-settings.v1'))); expect(cache.preferences.widgetLayout).toEqual(storedLayout(env));
    expect((await b.locator('#widget-surface').boundingBox()).width).toBeLessThan((await a.locator('#widget-surface').boundingBox()).width);
  } finally { await a.close(); await other.close(); await env.close(); }
});

test('custom/automatic transitions preserve a pending stubbed Wake, selected readings, and safe new-tab bookmarks', async ({ page }) => {
  let sent = 0; let releaseWake; let url; let deviceReads = 0; let bookmarkReads = 0; let wakeRequests = 0;
  const services = {
    homeAssistant: { clearCache() {}, async listDevices() { deviceReads++; return [{ deviceId: 'fixture-sensor', name: 'Fixture sensor', area: 'Office', disabled: false, measurements: [{ entityId: 'sensor.temperature', name: 'Temperature', value: '21', unit: '°C', status: 'available', available: true }] }]; } },
    linkwarden: { clearCache() {}, listCollections: async () => [{ id: 1, name: 'Root', children: [] }], async getBookmarks() { bookmarkReads++; return { bookmarks: [{ id: 1, name: 'Fixture link', url: `${url}/api/health` }], stale: false }; } },
    wakeExecutor: async ({ markWake, audit }) => { sent++; await new Promise(resolve => { releaseWake = resolve; }); markWake(); audit('sent', 'fixture'); return { sent: true, dispatch: { sent: 1, attempted: 1 } }; }
  };
  const env = await environment({ widgetLayout: layout() }, services); url = env.base;
  try {
    env.store.saveHomeAssistant({ baseUrl: 'https://fixture.invalid', encryptedAccessToken: encryptApiKey('fixture-token', env.secret) });
    env.store.saveLinkwarden({ baseUrl: 'https://links.invalid', username: 'fixture', encryptedAccessToken: encryptApiKey('fixture-token', env.secret) });
    env.store.create({ name: 'Fixture PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: null, group: '' });
    const devices = await (await fetch(`${env.base}/api/home-assistant/devices?controls=0`)).json();
    const collections = await (await fetch(`${env.base}/api/linkwarden/collections`)).json();
    const catalog = await (await fetch(`${env.base}/api/bookmarks?collection=${collections.collections[0].collectionToken}`)).json();
    const current = env.store.getDashboardPreferences();
    env.store.saveDashboardPreferences({ ...current.preferences, homeAssistantDeviceSelections: [devices.devices[0].selectionId], bookmarkLinkSelections: [{ selectionId: catalog.bookmarks[0].selectionId, collectionSelectionId: catalog.collectionSelectionId }] }, current.revision);
    page.on('request', request => { if (request.method() === 'POST' && /\/api\/devices\/[^/]+\/wake$/.test(request.url())) wakeRequests++; });
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env);
    await expect(page.locator('#dashboard-ha-devices')).toContainText('Temperature: 21 °C');
    const link = page.getByRole('link', { name: 'Fixture link', exact: true }); await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', /noopener/);
    const popup = page.waitForEvent('popup'); await link.click(); const opened = await popup; await opened.waitForURL(`${env.base}/api/health`); await opened.close();
    const button = page.getByRole('button', { name: 'Wake Fixture PC', exact: true }); await button.click(); await expect.poll(() => sent).toBe(1); await expect(button).toBeDisabled();
    await page.evaluate(() => { window.pendingLayoutWake = document.querySelector('#dashboard-wol-devices button'); window.layoutSensor = document.querySelector('#dashboard-ha-devices > li'); });
    const reads = { devices: deviceReads, bookmarks: bookmarkReads };
    await open(page); await page.locator('#layout-arrangement').selectOption('automatic'); await save(page);
    await open(page); await page.locator('#layout-arrangement').selectOption('custom');
    let popups = 0; page.on('popup', () => popups++);
    await page.evaluate(() => { window.pendingLayoutWake.click(); document.querySelector('#bookmark-tree a').click(); });
    await expect(page.locator('#dashboard-wol')).toHaveAttribute('inert', ''); expect(sent).toBe(1); expect(popups).toBe(0);
    // Complete the original owner while the draft and inert roots remain active.
    await page.locator('#layout-toggle').click(); await expect(page.locator('#layout-details')).toBeHidden();
    releaseWake(); await expect(button).toBeEnabled(); await expect(page.locator('#dashboard-wol-action-status')).toContainText('does not confirm');
    await page.evaluate(() => {
      const button = window.pendingLayoutWake;
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      // A detached stale row bypasses document capture; the injected dispatcher must still refuse it.
      const parent = button.parentNode; const next = button.nextSibling; button.remove(); button.click(); parent.insertBefore(button, next);
    });
    expect(await link.evaluate(node => !node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))).toBe(true);
    const linkBox = await link.boundingBox(); await page.mouse.click(linkBox.x + 2, linkBox.y + 2); expect(popups).toBe(0); expect(wakeRequests).toBe(1);
    expect(sent).toBe(1); await save(page);
    expect(await page.evaluate(() => window.pendingLayoutWake === document.querySelector('#dashboard-wol-devices button') && window.layoutSensor === document.querySelector('#dashboard-ha-devices > li'))).toBe(true);
    await expect(button).toBeEnabled(); expect(sent).toBe(1); expect({ devices: deviceReads, bookmarks: bookmarkReads }).toEqual(reads);
    const resumed = page.waitForEvent('popup'); await link.click(); const reopened = await resumed; await reopened.waitForURL(`${env.base}/api/health`); await reopened.close();
    await button.click(); await expect.poll(() => wakeRequests).toBe(2); expect(sent).toBe(1); // The existing server cooldown still owns repeated dispatch.
  } finally { releaseWake?.(); await page.goto('about:blank'); await env.close(); }
});

test('confirmed cached layouts remain usable offline without becoming writable server authority', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() });
  try {
    await ready(page, env); const saved = env.store.getDashboardPreferences();
    await page.route('**/api/dashboard/settings', route => route.abort()); await page.reload();
    await expect(page.locator('#widget-surface')).toBeVisible(); await expect(page.locator('#settings-status')).not.toHaveText('Loading shared preferences…');
    await open(page); await expect(page.locator('#layout-save')).toBeDisabled(); await expect(page.locator('#layout-arrangement')).toHaveValue('custom');
    expect(env.store.getDashboardPreferences()).toEqual(saved);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard.shared-settings.v1')).preferences.widgetLayout)).toEqual(saved.preferences.widgetLayout);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('bottom-left coordinates move upward and resize upward while preserving the bottom anchor', async ({ page }) => {
  const env = await environment({ widgetLayout: layout() });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env); await open(page);
    await page.locator('#layout-widget').selectOption('time'); await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
    await pixel(page, 'x', 0); await pixel(page, 'y', 0); await pixel(page, 'w', 200); await pixel(page, 'h', 120); await save(page);
    let area = await page.locator('#widget-surface').boundingBox(); let clock = await page.locator('#clock').boundingBox();
    expect(clock.x).toBe(area.x); expect(clock.y + clock.height).toBe(area.y + area.height);
    const bottom = clock.y + clock.height;
    await open(page); await page.locator('#layout-h').fill('170');
    await page.evaluate(async () => { window.dispatchEvent(new Event('resize')); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await expect(page.locator('#layout-h')).toHaveValue('170'); await page.locator('#layout-h').press('Tab');
    await save(page);
    clock = await page.locator('#clock').boundingBox(); expect(clock.height).toBe(170); expect(clock.y + clock.height).toBe(bottom);
    await open(page); await pixel(page, 'y', 30); await save(page);
    clock = await page.locator('#clock').boundingBox(); expect(clock.y + clock.height).toBe(bottom - 30);
    await open(page); const beforeMove = structuredClone(storedLayout(env).desktop.items.find(item => item.id === 'time'));
    await drag(page, 'move', 'time', 0, -10); await save(page);
    const moved = storedLayout(env).desktop.items.find(item => item.id === 'time'); expect(moved.y).toBeGreaterThan(beforeMove.y); expect(moved.h).toBe(beforeMove.h); expect(moved.w).toBe(beforeMove.w);
    const beforeResize = structuredClone(moved); await open(page); await drag(page, 'resize', 'time', 0, -8); await save(page);
    const resized = storedLayout(env).desktop.items.find(item => item.id === 'time'); expect(resized.h).toBeGreaterThan(beforeResize.h); expect(resized.y).toBe(beforeResize.y); expect(resized.w).toBe(beforeResize.w);
    await open(page); await pixel(page, 'y', 0); await save(page); const canonical = storedLayout(env);
    for (const height of [600, 1000]) { await page.setViewportSize({ width: 1200, height }); await expect.poll(async () => { const a = await page.locator('#widget-surface').boundingBox(); const b = await page.locator('#clock').boundingBox(); return b.y + b.height - a.y - a.height; }).toBe(0); }
    expect(storedLayout(env)).toEqual(canonical);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('tiny live border boxes match projection independently on each axis', async ({ page }) => {
  const widgetLayout = edgeLayout(); const env = await environment({ widgetLayout });
  try {
    await controlledViewport(page); await ready(page, env);
    for (const mode of ['desktop', 'mobile']) {
      await page.setViewportSize({ width: mode === 'desktop' ? 1200 : 600, height: 800 });
      for (const fontSize of [16, 24]) {
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
        for (const [width, height] of [[1, 200], [10, 200], [200, 1], [200, 10], [1, 1], [10, 10], [800, 500]]) {
          await usableSurface(page, width, height); await assertProjectedBoxes(page, widgetLayout, mode);
        }
        for (const id of ['clock', 'weather', 'calendar', 'bookmarks', 'dashboard-ha', 'dashboard-wol']) await expect(page.locator(`#${id}`)).toHaveCSS('padding', `${fontSize / 2}px`);
      }
    }
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('direct frame reference geometry stays fixed while destination dimensions shrink', async ({ page }) => {
  const widgetLayout = edgeLayout(); const env = await environment({ widgetLayout });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await controlledViewport(page); await ready(page, env); await open(page);
    for (const mode of ['desktop', 'mobile']) {
      await page.locator('#layout-profile').selectOption(mode);
      for (const [width, height] of [[1, 200], [200, 1], [1, 1], [10, 10], [1, 1000], [800, 500]]) {
        await usableSurface(page, width, height); const boxes = await assertProjectedBoxes(page, widgetLayout, mode, true);
        expect(boxes.every(box => box.expected.width > 0 && box.expected.height > 0)).toBe(true);
      }
    }
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('tiny and zero surfaces recover without draft changes or preference writes', async ({ page }) => {
  const widgetLayout = edgeLayout(); const env = await environment({ widgetLayout }); const writes = [];
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await controlledViewport(page); await ready(page, env); await open(page);
    page.on('request', request => { if (request.url().endsWith('/api/dashboard/settings') && request.method() === 'PUT') writes.push(request.postDataJSON()); });
    const original = env.store.getDashboardPreferences();
    await usableSurface(page, 800, 500); const before = await assertProjectedBoxes(page, widgetLayout, 'desktop');
    for (const [width, height] of [[10, 200], [200, 10], [1, 1], [0, 200], [200, 0]]) {
      await usableSurface(page, width, height);
      if (!width || !height) {
        await expect(page.locator('#widget-surface')).toBeHidden(); await expect(page.locator('#layout-frames')).toBeHidden();
        for (const key of ['x', 'y', 'w', 'h']) await expect(page.locator(`#layout-${key}`)).toBeDisabled();
      } else { await assertProjectedBoxes(page, widgetLayout, 'desktop'); await assertProjectedBoxes(page, widgetLayout, 'desktop', true); }
    }
    await usableSurface(page, 800, 500);
    await expect(page.locator('#layout-w')).toBeEnabled(); await expect(page.locator('#layout-frames')).toBeVisible();
    expect(await assertProjectedBoxes(page, widgetLayout, 'desktop')).toEqual(before);
    expect(writes).toEqual([]); expect(env.store.getDashboardPreferences()).toEqual(original);
    // An explicit no-op save proves the recovered editor still contains exact canonical data.
    await save(page); expect(writes).toHaveLength(0);
    expect(env.store.getDashboardPreferences()).toEqual(original);
    await open(page); await page.locator('#layout-arrangement').selectOption('automatic'); await save(page);
    for (const id of ['clock', 'weather', 'calendar', 'bookmarks', 'dashboard-ha', 'dashboard-wol']) {
      expect(await page.locator(`#${id}`).evaluate(node => [node.style.getPropertyValue('--widget-width'), node.style.getPropertyValue('--widget-height')])).toEqual(['', '']);
    }
    await open(page); await page.locator('#layout-arrangement').selectOption('custom'); await save(page);
    await assertProjectedBoxes(page, storedLayout(env), 'desktop');
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('custom weather content is independent of fullscreen bookmark visibility', async ({ page }) => {
  const widgetLayout = edgeLayout(); widgetLayout.desktop.items.find(item => item.id === 'weather').w = 100000;
  const env = await environment({ widgetLayout, hideBookmarksFullscreen: true });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await ready(page, env);
    const preferences = env.store.getDashboardPreferences().preferences;
    await page.evaluate(() => { document.getElementById('forecast-details').hidden = false; const daily = document.getElementById('daily'); daily.hidden = false; daily.innerHTML = '<li><span class="forecast-temperature">−123456789–123456789°C</span></li>'; });
    const sample = async fullscreen => page.evaluate(async ({ preferences, fullscreen }) => {
      const { dashboardDisplay, applyDashboardDisplay } = await import('/dashboard-display.js');
      applyDashboardDisplay(document, dashboardDisplay(preferences, { fullscreen }));
      const node = document.querySelector('#daily .forecast-temperature'); const weather = document.getElementById('weather');
      const scale = weather.getBoundingClientRect().width / Number.parseFloat(weather.style.width);
      const card = weather.getBoundingClientRect(); const child = node.getBoundingClientRect();
      return { flex: getComputedStyle(document.getElementById('current-weather-values')).flex, whiteSpace: getComputedStyle(node).whiteSpace, x: (child.x - card.x) / scale, y: (child.y - card.y) / scale, width: child.width / scale, height: child.height / scale };
    }, { preferences, fullscreen });
    const before = await sample(false); const during = await sample(true);
    await expect(page.locator('#bookmarks')).toBeHidden(); expect(during).toEqual(before);
    expect(await sample(false)).toEqual(before); await expect(page.locator('#bookmarks')).toBeVisible();
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('fullscreen reference uniformly fits different windows and confirms once without writes', async ({ page }) => {
  const widgetLayout = edgeLayout(); const env = await environment({ widgetLayout }); let writes = 0;
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await controlledViewport(page); await ready(page, env);
    page.on('request', request => { if (request.url().endsWith('/api/dashboard/settings') && request.method() === 'PUT') writes++; });
    const original = env.store.getDashboardPreferences();
    const initial = await canvasState(page); expect(initial.reference).toEqual({ width: 1600, height: 1000 }); expect(initial.source).toBe('estimated');
    for (const [width, height] of [[1000, 400], [400, 1000], [10, 200], [800, 500]]) {
      await usableSurface(page, width, height); const state = await canvasState(page); assertCanvasFit(state);
      expect(state.reference).toEqual(initial.reference);
      expect(Math.abs((state.textHeight - initial.textHeight) * state.scale), 'rendered text follows the same scale within CSS subpixel rounding').toBeLessThanOrEqual(.1);
      await assertProjectedBoxes(page, widgetLayout, 'desktop');
    }
    await page.evaluate(() => document.documentElement.requestFullscreen()); await settleFrames(page);
    const confirmedSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const confirmed = await canvasState(page); expect(confirmed.source).toBe('confirmed'); expect(confirmed.reference).toEqual(confirmedSize); assertCanvasFit(confirmed);
    await page.evaluate(() => document.exitFullscreen()); await settleFrames(page);
    expect((await canvasState(page)).reference).toEqual(confirmed.reference);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => document.documentElement.requestFullscreen()); await settleFrames(page);
      expect((await canvasState(page)).reference).toEqual(confirmed.reference);
      await page.evaluate(() => document.exitFullscreen()); await settleFrames(page);
    }
    await usableSurface(page, 500, 300); assertCanvasFit(await canvasState(page));
    expect(writes).toBe(0); expect(env.store.getDashboardPreferences()).toEqual(original);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('direct editing holds reference pixels across display changes and fullscreen confirmation until cancel', async ({ page }) => {
  const env = await environment({ widgetLayout: edgeLayout() }); let writes = 0;
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await controlledViewport(page); await ready(page, env); await open(page);
    page.on('request', request => { if (request.url().endsWith('/api/dashboard/settings') && request.method() === 'PUT') writes++; });
    const original = env.store.getDashboardPreferences(); const old = (await canvasState(page)).reference;
    await pixel(page, 'w', 180); const draftWidth = await page.locator('#layout-w').inputValue();
    await page.evaluate(() => { Object.defineProperty(screen, 'width', { configurable: true, value: 1900 }); window.dispatchEvent(new Event('resize')); }); await settleFrames(page);
    expect((await canvasState(page)).reference).toEqual(old); await expect(page.locator('#layout-w')).toHaveValue(draftWidth);
    await page.evaluate(() => document.documentElement.requestFullscreen()); await settleFrames(page);
    expect((await canvasState(page)).reference).toEqual(old); await expect(page.locator('#layout-w')).toHaveValue(draftWidth);
    const confirmedSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.evaluate(() => document.exitFullscreen()); await settleFrames(page);
    await page.locator('#layout-cancel').click();
    const confirmed = (await canvasState(page)).reference; expect(confirmed).toEqual(confirmedSize);
    await open(page); expect((await canvasState(page)).reference).toEqual(confirmed);
    expect(writes).toBe(0); expect(env.store.getDashboardPreferences()).toEqual(original);
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('invalid screen data falls back once and destination reservations never redefine its reference', async ({ page }) => {
  const env = await environment({ widgetLayout: edgeLayout() });
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await controlledViewport(page, { width: 0, height: 0 }); await ready(page, env);
    const initial = await canvasState(page); expect(initial.reference).toEqual({ width: 1200, height: 800 }); expect(initial.source).toBe('fallback');
    await page.setViewportSize({ width: 900, height: 600 }); await usableSurface(page, 400, 300);
    await page.evaluate(() => { document.documentElement.style.setProperty('--layout-safe-left', '10px'); document.getElementById('page-status').textContent = 'A longer status message '.repeat(30); document.getElementById('photo-caption').textContent = 'Fixture caption'; window.dispatchEvent(new Event('resize')); });
    await settleFrames(page); const changed = await canvasState(page); expect(changed.reference).toEqual(initial.reference); assertCanvasFit(changed);
    expect(env.store.getDashboardPreferences().preferences.widgetLayout).toEqual(edgeLayout());
  } finally { await page.goto('about:blank'); await env.close(); }
});

test('direct tiny references retain borderless subpixel previews and bounded live padding', async ({ browser }) => {
  const widgetLayout = edgeLayout(); const env = await environment({ widgetLayout });
  try {
    for (const size of [{ width: 1, height: 200 }, { width: 200, height: 1 }, { width: 1, height: 1000 }]) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      try {
        await controlledViewport(page, size); await ready(page, env); await open(page);
        const reference = (await canvasState(page)).reference;
        expect(reference.width === 1 || reference.height === 1).toBe(true);
        await assertProjectedBoxes(page, widgetLayout, 'desktop'); const boxes = await assertProjectedBoxes(page, widgetLayout, 'desktop', true);
        expect(boxes.some(box => box.expected.width < 2 || box.expected.height < 2)).toBe(true);
      } finally { await page.close(); }
    }
  } finally { await env.close(); }
});

test('real fullscreen bookmark hiding preserves reference-local forecast lines and weather flow', async ({ page }) => {
  const widgetLayout = edgeLayout(); widgetLayout.desktop.items.find(item => item.id === 'weather').w = 100000;
  const env = await environment({ widgetLayout, hideBookmarksFullscreen: true }); let writes = 0;
  try {
    await page.setViewportSize({ width: 1200, height: 800 }); await controlledViewport(page); await ready(page, env);
    page.on('request', request => { if (request.url().endsWith('/api/dashboard/settings') && request.method() === 'PUT') writes++; });
    const original = env.store.getDashboardPreferences();
    await page.evaluate(() => document.documentElement.requestFullscreen()); await settleFrames(page);
    await page.evaluate(() => document.exitFullscreen()); await settleFrames(page);
    await page.evaluate(() => { document.getElementById('forecast-details').hidden = false; document.getElementById('daily').innerHTML = '<li><span class="forecast-temperature">−123456789–123456789°C</span></li>'; });
    const sample = () => page.evaluate(() => {
      const card = document.getElementById('weather'); const node = document.querySelector('#daily .forecast-temperature');
      const scale = card.getBoundingClientRect().width / Number.parseFloat(card.style.width); const bounds = card.getBoundingClientRect(); const child = node.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(node);
      return { flex: getComputedStyle(document.getElementById('current-weather-values')).flex, whiteSpace: getComputedStyle(node).whiteSpace, lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.y / scale))).size, x: (child.x - bounds.x) / scale, y: (child.y - bounds.y) / scale, width: child.width / scale, height: child.height / scale };
    });
    const before = await sample(); expect(before.lines).toBeGreaterThan(1); expect(before.height).toBeGreaterThan(0);
    await page.evaluate(() => document.documentElement.requestFullscreen()); await settleFrames(page);
    await expect(page.locator('#bookmarks')).toBeHidden(); const during = await sample();
    for (const key of ['x', 'y', 'width', 'height']) expect(during[key]).toBeCloseTo(before[key], 1);
    expect(during.lines).toBe(before.lines); expect(during.flex).toBe(before.flex); expect(during.whiteSpace).toBe(before.whiteSpace);
    await assertProjectedBoxes(page, widgetLayout, 'desktop');
    await page.evaluate(() => document.exitFullscreen()); await settleFrames(page); await expect(page.locator('#bookmarks')).toBeVisible();
    const after = await sample(); for (const key of ['x', 'y', 'width', 'height']) expect(after[key]).toBeCloseTo(before[key], 1);
    expect(after.lines).toBe(before.lines); expect(writes).toBe(0); expect(env.store.getDashboardPreferences()).toEqual(original);
  } finally { await page.goto('about:blank'); await env.close(); }
});
