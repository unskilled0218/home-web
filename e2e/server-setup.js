import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

// Use the production shutdown handler without OS signals, which some containers deny.
const source = `
const shutdown = () => { if (!process.emit('SIGTERM')) process.exit(0); };
process.on('message', (message) => { if (message === 'shutdown') shutdown(); });
process.on('disconnect', shutdown);
await import('./src/server.js');
`;

export default async function setup(config) {
  const url = new URL(config.projects[0].use.baseURL);
  const directory = await mkdtemp('/tmp/opencode/home-web-playwright-');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, HOST: url.hostname, PORT: url.port, DATABASE_PATH: path.join(directory, 'app.db'), LINKWARDEN_CONFIG_ENCRYPTION_KEY: '', LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE: path.join(directory, 'integration.key'), HOME_ASSISTANT_CA_FILE: '', LINKWARDEN_CA_FILE: '', CALDAV_CA_FILE: '', NODE_EXTRA_CA_CERTS: '', NFS_MOUNT_MODE: 'off' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk; });
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) { await rm(directory, { recursive: true, force: true }); return; }
    const exited = once(child, 'exit'); child.send('shutdown');
    let deadline;
    try { await Promise.race([exited, new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Browser-test server IPC shutdown timed out.')), 10000); })]); }
    finally { clearTimeout(deadline); if (child.exitCode !== null || child.signalCode !== null) await rm(directory, { recursive: true, force: true }); }
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Browser-test server startup timed out: ${stderr}`)), 10000);
      function ready(chunk) { if (chunk.toString().includes(`dashboard listening at ${url.origin}`)) finish(); }
      function failed(code) { finish(new Error(`Browser-test server exited (${code}): ${stderr}`)); }
      function finish(error) { clearTimeout(timer); child.stdout.off('data', ready); child.off('exit', failed); child.off('error', finish); if (error) reject(error); else resolve(); }
      child.stdout.on('data', ready); child.once('exit', failed); child.once('error', finish);
    });
  } catch (error) { await stop(); throw error; }
  return stop;
}
