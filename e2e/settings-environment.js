import { once } from 'node:events';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { createDashboardServer } from '../src/app.js';
import { createWeatherService } from '../src/weather.js';
import { createLocalWeatherService } from '../src/local-weather.js';
import { createPhotoLibrary } from '../src/photo-library.js';
import { createPhotoSlideshow } from '../src/photo-slideshow.js';
import { normalizeDashboardPreferences } from '../public/dashboard-helpers.js';
import { rawForecast } from '../test/fixtures/weather.js';
import { slideshowClock } from '../test/fixtures/photo-slideshow.js';
import { tick } from '../test/fixtures/lifecycle.js';

export async function settingsEnvironment() {
  const directory = await mkdtemp('/tmp/opencode/settings-scope-browser-'); const photos = path.join(directory, 'photos'); await mkdir(photos);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  for (let i = 0; i < 2; i++) await writeFile(path.join(photos, `${i}.png`), png);
  const clock = slideshowClock(); let store; let server; let weather; let localWeather; let slideshow; let base;
  const provider = async url => Response.json(url.hostname.startsWith('air-') ? { current: { us_aqi: 20 } } : rawForecast(Number(url.searchParams.get('latitude'))));
  async function start() {
    store = createStore(path.join(directory, 'app.db'));
    if (!store.getDashboardPreferences().initialized) store.saveDashboardPreferences(normalizeDashboardPreferences({ color: '#222222', imageInfo: true, order: 'name', interval: 60, animation: 'none' }), 0);
    if (!store.getWeatherLocation().location) store.saveWeatherLocation({ latitude: 51, longitude: 0, label: 'London' }, store.getWeatherLocation().revision);
    weather = createWeatherService({ store, ...clock, fetchImpl: provider }); localWeather = createLocalWeatherService({ ...clock, fetchImpl: provider });
    const photoLibrary = createPhotoLibrary({ root: photos }); slideshow = createPhotoSlideshow({ ...clock, photoLibrary, preferences: store.getDashboardPreferences().preferences });
    server = createDashboardServer({ store, weather, localWeather, slideshow, photoLibrary, photoSourceEnabled: true, runtimeConfig: { allowedHosts: ['127.0.0.1'] } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; weather.start(); localWeather.start(); await slideshow.start(); await tick();
  }
  async function stop() { await Promise.all([server.lifecycle.shutdown(), weather.stop(), localWeather.stop(), slideshow.stop()]); store.close(); }
  await start();
  return { get base() { return base; }, get store() { return store; }, get slideshow() { return slideshow; }, clock, async restart() { await stop(); await start(); }, async close() { await stop(); await rm(directory, { recursive: true, force: true }); } };
}

export async function scopeClient(browser, env) {
  const context = await browser.newContext(); const page = await context.newPage(); await page.clock.install(); await page.goto(env.base);
  return { context, page, close: () => context.close() };
}
