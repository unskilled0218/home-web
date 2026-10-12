import { config } from './config.js';
import { createStore } from './db.js';
import { createLinkwardenClient } from './linkwarden.js';
import { loadLinkwardenCa } from './linkwarden-ca.js';
import { createDashboardServer } from './app.js';
import { createHomeAssistantClient } from './home-assistant.js';
import { loadScopedCa, validateCaFile } from './ca-file.js';
import { createHomeAssistantControlStore } from './home-assistant-controls.js';
import { createCalDavClient } from './caldav.js';
import { prepareNfs } from './nfs.js';
import { createPhotoLibrary, createUnavailablePhotoLibrary } from './photo-library.js';
import { createWeatherService } from './weather.js';

await validateCaFile(config.nodeExtraCaFile);
const ca = await loadLinkwardenCa(config.linkwardenCaFile);
const calDavCa = await loadScopedCa(config.calDavCaFile, 'CALDAV_CA_FILE');
const store = createStore(config.databasePath);
const linkwarden = createLinkwardenClient({ cacheSeconds: config.linkwardenCacheSeconds, ca });
const homeAssistant = createHomeAssistantClient({ cacheSeconds: config.homeAssistantCacheSeconds });
const homeAssistantControls = createHomeAssistantControlStore();
const calDav = createCalDavClient({ cacheSeconds: config.calDavCacheSeconds, ca: calDavCa });
const nfs = await prepareNfs(config.nfs);
if (config.nfs.error || nfs.reason === 'failed') console.warn('NFS backgrounds are unavailable; starting the dashboard without photos.');
const photoLibrary = nfs.available ? createPhotoLibrary({ root: nfs.root }) : createUnavailablePhotoLibrary();
const weather = createWeatherService({ store });
const server = createDashboardServer({ runtimeConfig: config, store, linkwarden, homeAssistant, homeAssistantControls, calDav, photoLibrary, weather });
weather.start();

server.listen(config.port, config.host, () => console.log(`dashboard listening at http://${config.host}:${config.port}`));
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const closed = new Promise((resolve) => server.close(resolve));
  void Promise.all([closed, weather.stop()]).then(() => { store.close(); process.exit(0); });
});
