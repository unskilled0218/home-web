import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await loadEnvFile(process.env.DASHBOARD_ENV_FILE || path.join(root, '.env'));
await import('./server.js');
