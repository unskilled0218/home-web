import { config } from './config.js';
import { createStore } from './db.js';
import { createLinkwardenClient } from './linkwarden.js';
import { loadLinkwardenCa } from './linkwarden-ca.js';
import { createDashboardServer } from './app.js';

const ca = await loadLinkwardenCa(config.linkwardenCaFile);
const store = createStore(config.databasePath);
const linkwarden = createLinkwardenClient({ cacheSeconds: config.linkwardenCacheSeconds, ca });
const server = createDashboardServer({ runtimeConfig: config, store, linkwarden });

server.listen(config.port, config.host, () => console.log(`dashboard listening at http://${config.host}:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
