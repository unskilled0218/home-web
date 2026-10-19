import { createShutdownCoordinator } from './shutdown.js';
import { createStore } from './db.js';
import { createLinkwardenClient } from './linkwarden.js';
import { loadLinkwardenCa } from './linkwarden-ca.js';
import { createHomeAssistantClient } from './home-assistant.js';
import { loadScopedCa, validateCaFile } from './ca-file.js';
import { createHomeAssistantControlStore } from './home-assistant-controls.js';
import { createCalDavClient } from './caldav.js';
import { prepareNfs } from './nfs.js';
import { createPhotoLibrary, createUnavailablePhotoLibrary } from './photo-library.js';
import { createWeatherService } from './weather.js';
import { createLocalWeatherService } from './local-weather.js';
import { createPhotoSlideshow } from './photo-slideshow.js';
import { resolveLinkwardenEncryptionKey } from './linkwarden-key.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

function notify(message) { if (process.connected) { try { process.send(message, () => {}); } catch { /* Supervisor loss is handled by disconnect. */ } } }
const lifecycle = createShutdownCoordinator({ notify });
let exiting;
function stop(error) {
  const stopped = error ? lifecycle.fail(error) : lifecycle.shutdown();
  if (!exiting) exiting = stopped.then((result) => {
    const exit = () => {
      for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal);
      process.removeListener('message', onMessage); process.removeListener('disconnect', onSignal);
      process.exit(result.code);
    };
    if (process.connected) {
      const deadline = setTimeout(exit, 100);
      try { process.send({ type: 'dashboard:stopped', ...result }, () => { clearTimeout(deadline); exit(); }); } catch { clearTimeout(deadline); exit(); }
    } else exit();
  });
  return exiting;
}
const onSignal = () => { void stop(); };
const onMessage = (message) => { if (message?.type === 'dashboard:shutdown') onSignal(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, onSignal);
if (process.channel) { process.on('message', onMessage); process.on('disconnect', onSignal); }
notify({ type: 'dashboard:control-ready' });

async function boot() {
  const { config: parsedConfig } = await import('./config.js');
  let config = parsedConfig;
  if (lifecycle.stopping) return;
  const { createDashboardServer } = await import('./app.js');
  if (lifecycle.stopping) return;
  await validateCaFile(config.nodeExtraCaFile);
  if (lifecycle.stopping) return;
  const ca = await loadLinkwardenCa(config.linkwardenCaFile);
  if (lifecycle.stopping) return;
  const calDavCa = await loadScopedCa(config.calDavCaFile, 'CALDAV_CA_FILE');
  if (lifecycle.stopping) return;
  const homeAssistantCa = await loadScopedCa(config.homeAssistantCaFile, 'HOME_ASSISTANT_CA_FILE');
  if (lifecycle.stopping) return;
  mkdirSync(path.dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const store = createStore(config.databasePath); lifecycle.attach('store', store);
  config = { ...config, linkwardenEncryptionKey: resolveLinkwardenEncryptionKey({ explicitSecret: config.linkwardenEncryptionKey, filePath: config.linkwardenEncryptionKeyFile, hasEncryptedCredentials: Boolean(store.getLinkwarden() || store.getHomeAssistant() || store.getCalDav()) }) };
  if (lifecycle.stopping) return;
  const linkwarden = createLinkwardenClient({ cacheSeconds: config.linkwardenCacheSeconds, ca });
  const homeAssistant = createHomeAssistantClient({ cacheSeconds: config.homeAssistantCacheSeconds, ca: homeAssistantCa }); lifecycle.attach('homeAssistant', homeAssistant);
  const homeAssistantControls = createHomeAssistantControlStore();
  const calDav = createCalDavClient({ cacheSeconds: config.calDavCacheSeconds, ca: calDavCa });
  const nfs = await prepareNfs(config.nfs, { onChild: lifecycle.ownPreparation });
  if (lifecycle.stopping) return;
  if (lifecycle.getState().pendingPreparations || lifecycle.getState().failure === 'cleanup') throw new Error('NFS preparation cleanup is unconfirmed. Use disabled/pre-mounted NFS or permit owned-child termination.');
  if (config.nfs.error || nfs.reason === 'failed') console.warn('NFS backgrounds are unavailable; starting the dashboard without photos.');
  const photoLibrary = nfs.available ? createPhotoLibrary({ root: nfs.root }) : createUnavailablePhotoLibrary();
  lifecycle.attach('photoLibrary', photoLibrary);
  const weather = createWeatherService({ store }); lifecycle.attach('weather', weather);
  const localWeather = createLocalWeatherService(); lifecycle.attach('localWeather', localWeather);
  let photoPreferences;
  try { photoPreferences = store.getDashboardPreferences().preferences; } catch { console.warn('Shared photo preferences are unavailable; slideshow rotation is paused.'); }
  const slideshow = createPhotoSlideshow({ photoLibrary, enabled: config.nfs.mode !== 'disabled', preferences: photoPreferences }); lifecycle.attach('slideshow', slideshow);
  const server = createDashboardServer({ runtimeConfig: config, store, linkwarden, homeAssistant, homeAssistantControls, calDav, photoLibrary, photoSourceEnabled: config.nfs.mode !== 'disabled', weather, localWeather, slideshow }); lifecycle.attach('server', server);
  server.on('error', (error) => { void stop(error); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  if (lifecycle.stopping) { await new Promise((resolve) => server.close(() => resolve())); return; }
  weather.start();
  localWeather.start();
  void slideshow.start();
  console.log(`dashboard listening at http://${config.host}:${config.port}`);
  notify({ type: 'dashboard:ready' });
}
try { await boot(); } catch (error) { void stop(error); } finally { lifecycle.startupFinished(); }
