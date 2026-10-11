import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('connects atomically and navigates collections through opaque tokens', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-api-'));
  const certificatePath = path.join(directory, 'certificate.pem');
  const keyPath = path.join(directory, 'key.pem');
  try {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    } catch (error) {
      context.skip(`OpenSSL is required for the Linkwarden API test: ${error.message}`);
      return;
    }
    let collectionResponse = [{ id: 1, name: 'Root' }, { id: 2, name: 'Child', parentId: 1 }];
    const linkwarden = https.createServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) }, (request, response) => {
      if (request.headers.authorization !== 'Bearer working-token') { response.writeHead(401); response.end(); return; }
      if (request.url === '/api/v1/collections') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ response: collectionResponse }));
        return;
      }
      if (request.url === '/api/v1/search?collectionId=2') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"data":{"links":[{"id":9,"name":"Docs","url":"https://example.test/docs"}],"nextCursor":null},"success":true,"message":"Success"}');
        return;
      }
      response.writeHead(404); response.end();
    });
    linkwarden.listen(0, '127.0.0.1');
    await once(linkwarden, 'listening');
    const dashboardPort = await availablePort();
    let child;
    let stopped = false;
    const validEncryptionKey = Buffer.alloc(32, 9).toString('base64');
    const startDashboard = async (encryptionKey = validEncryptionKey) => {
      child = spawn(process.execPath, ['src/server.js'], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(dashboardPort),
          DATABASE_PATH: path.join(directory, 'dashboard.db'),
          LINKWARDEN_CONFIG_ENCRYPTION_KEY: encryptionKey,
          LINKWARDEN_CA_FILE: certificatePath
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Dashboard startup timed out.')), 5_000);
        child.stdout.on('data', (chunk) => { if (chunk.toString().includes('dashboard listening')) { clearTimeout(timer); resolve(); } });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Dashboard exited during startup with code ${code}.`)); });
      });
    };
    const stopDashboard = async () => {
      if (child?.exitCode == null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    };
    const shutdown = async () => {
      if (stopped) return;
      stopped = true;
      await stopDashboard();
      await new Promise((resolve) => linkwarden.close(resolve));
    };
    context.after(shutdown);
    await startDashboard();
    const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
    const api = async (pathname, options = {}) => {
      const response = await fetch(`${dashboardUrl}${pathname}`, { headers: { 'content-type': 'application/json' }, ...options });
      return { response, body: response.status === 204 ? {} : await response.json() };
    };
    const baseUrl = `https://127.0.0.1:${linkwarden.address().port}`;
    const connected = await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify({ url: baseUrl, username: 'musty', accessToken: 'working-token' }) });
    assert.equal(connected.response.status, 200);
    assert.equal(connected.body.linkwarden.configured, true);
    assert.equal(connected.body.collections[0].name, 'Root');
    assert.equal(connected.body.collections[0].children[0].name, 'Child');
    assert.equal(JSON.stringify(connected.body).includes('working-token'), false);
    assert.equal(Object.hasOwn(connected.body.collections[0], 'id'), false);
    const oldCollectionToken = connected.body.collections[0].children[0].collectionToken;

    const listed = await api('/api/linkwarden/collections');
    assert.equal(listed.response.status, 200);
    const collectionToken = listed.body.collections[0].children[0].collectionToken;
    const bookmarks = await api(`/api/bookmarks?collection=${encodeURIComponent(collectionToken)}`);
    assert.equal(bookmarks.response.status, 200);
    assert.deepEqual(bookmarks.body.bookmarks, [{ id: 9, name: 'Docs', url: 'https://example.test/docs' }]);

    await stopDashboard();
    await startDashboard('invalid-key');
    const unreadable = await api('/api/linkwarden');
    assert.equal(unreadable.body.linkwarden.configured, false);
    assert.equal(unreadable.body.linkwarden.needsReauthentication, true);
    assert.equal((await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify({ url: baseUrl, username: 'musty', accessToken: '' }) })).response.status, 400);
    await stopDashboard();
    await startDashboard();
    assert.equal((await api('/api/linkwarden')).body.linkwarden.configured, true);
    assert.equal((await api('/api/linkwarden/collections')).body.collections[0].children[0].name, 'Child');
    assert.equal((await api(`/api/bookmarks?collection=${encodeURIComponent(collectionToken)}`)).response.status, 400);

    const failed = await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify({ url: baseUrl, username: 'changed', accessToken: 'wrong-token' }) });
    assert.equal(failed.response.status, 400);
    const unchanged = await api('/api/linkwarden');
    assert.equal(unchanged.body.linkwarden.username, 'musty');

    const reconnected = await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify({ url: baseUrl, username: 'musty', accessToken: '' }) });
    assert.equal(reconnected.response.status, 200);
    const expiredSelection = await api(`/api/bookmarks?collection=${encodeURIComponent(oldCollectionToken)}`);
    assert.equal(expiredSelection.response.status, 400);

    collectionResponse = [];
    const emptyConnection = await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify({ url: baseUrl, username: 'musty', accessToken: '' }) });
    assert.equal(emptyConnection.response.status, 200);
    assert.deepEqual(emptyConnection.body.collections, []);
    assert.equal(emptyConnection.body.linkwarden.configured, true);

    assert.equal((await api('/api/linkwarden', { method: 'DELETE' })).response.status, 204);
    assert.equal((await api('/api/linkwarden')).body.linkwarden.configured, false);
    assert.equal((await api('/api/health')).body.status, 'ok');
    await shutdown();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
