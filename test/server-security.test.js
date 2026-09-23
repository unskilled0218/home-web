import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
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

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

function dashboardRequest(port, pathname, { method = 'GET', host, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const headers = { ...(host && { Host: host }), ...(origin && { Origin: origin }), ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }) };
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, body: text ? JSON.parse(text) : {} });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function rawRequest(port, requestText) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const chunks = [];
    socket.on('connect', () => socket.end(requestText));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

test('blocks rebinding hosts and never reuses a Linkwarden token for a changed identity', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lan-wake-security-'));
  const primaryRequests = [];
  const secondaryRequests = [];
  const linkwardenServer = (requests) => http.createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    if (request.url !== '/api/v1/collections' || !request.headers.authorization?.startsWith('Bearer ')) { response.writeHead(401); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"response":[{"id":1,"name":"Root"}]}');
  });
  const primary = linkwardenServer(primaryRequests);
  const secondary = linkwardenServer(secondaryRequests);
  const primaryUrl = await listen(primary);
  const secondaryUrl = await listen(secondary);
  const dashboardPort = await availablePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(dashboardPort),
      DATABASE_PATH: path.join(directory, 'dashboard.db'),
      DASHBOARD_ALLOWED_HOSTS: 'dashboard.test',
      LINKWARDEN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const close = async () => {
    if (child.exitCode == null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await Promise.all([new Promise((resolve) => primary.close(resolve)), new Promise((resolve) => secondary.close(resolve))]);
    rmSync(directory, { recursive: true, force: true });
  };
  context.after(close);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Dashboard startup timed out: ${stderr}`)), 5_000);
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes('dashboard listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Dashboard exited during startup with code ${code}: ${stderr}`)); });
  });

  assert.equal((await dashboardRequest(dashboardPort, '/api/health')).status, 200);
  assert.equal((await dashboardRequest(dashboardPort, '/api/health', { host: 'dashboard.test' })).status, 200);
  assert.equal((await dashboardRequest(dashboardPort, '/api/devices', { host: 'attacker.test' })).status, 403);
  assert.equal((await dashboardRequest(dashboardPort, '/api/bookmarks', { host: 'attacker.test' })).status, 403);
  assert.equal((await dashboardRequest(dashboardPort, '/api/devices', { method: 'POST', host: 'attacker.test', origin: 'http://attacker.test', body: {} })).status, 403);
  assert.equal((await dashboardRequest(dashboardPort, '/api/linkwarden', { method: 'PUT', host: 'attacker.test', origin: 'http://attacker.test', body: { url: primaryUrl, username: 'attacker', accessToken: 'stolen' } })).status, 403);
  assert.equal(primaryRequests.length, 0);
  assert.equal((await dashboardRequest(dashboardPort, '/api/devices', { method: 'POST', host: 'dashboard.test', origin: 'http://attacker.test', body: {} })).status, 403);
  assert.equal((await dashboardRequest(dashboardPort, '/api/devices', { method: 'POST', host: 'dashboard.test', origin: 'http://dashboard.test', body: { name: 'PC', macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255' } })).status, 201);

  const malformedHost = await rawRequest(dashboardPort, 'GET /api/health HTTP/1.1\r\nHost: [bad\r\nConnection: close\r\n\r\n');
  assert.match(malformedHost, /^HTTP\/1\.1 403/);
  const missingHost = await rawRequest(dashboardPort, 'GET /api/health HTTP/1.0\r\nConnection: close\r\n\r\n');
  assert.match(missingHost, /^HTTP\/1\.1 403/);
  assert.equal((await dashboardRequest(dashboardPort, '/api/health')).status, 200);
  assert.equal(child.exitCode, null);

  const validDashboard = { host: 'dashboard.test', origin: 'http://dashboard.test' };
  const connected = await dashboardRequest(dashboardPort, '/api/linkwarden', { method: 'PUT', ...validDashboard, body: { url: primaryUrl, username: 'musty', accessToken: 'working-token' } });
  assert.equal(connected.status, 200);
  assert.equal(primaryRequests.length, 1);

  const changedUrl = await dashboardRequest(dashboardPort, '/api/linkwarden', { method: 'PUT', ...validDashboard, body: { url: secondaryUrl, username: 'musty', accessToken: '' } });
  assert.equal(changedUrl.status, 400);
  assert.equal(secondaryRequests.length, 0);
  const changedUsername = await dashboardRequest(dashboardPort, '/api/linkwarden', { method: 'PUT', ...validDashboard, body: { url: primaryUrl, username: 'attacker', accessToken: '' } });
  assert.equal(changedUsername.status, 400);
  assert.equal(primaryRequests.length, 1);
  assert.equal((await dashboardRequest(dashboardPort, '/api/linkwarden', { host: 'dashboard.test' })).body.linkwarden.username, 'musty');

  assert.equal((await dashboardRequest(dashboardPort, '/api/linkwarden', { method: 'PUT', ...validDashboard, body: { url: primaryUrl, username: 'musty', accessToken: '' } })).status, 200);
  assert.equal(primaryRequests.length, 2);
  assert.equal((await dashboardRequest(dashboardPort, '/api/linkwarden', { method: 'PUT', ...validDashboard, body: { url: secondaryUrl, username: 'new-user', accessToken: 'new-token' } })).status, 200);
  assert.deepEqual(secondaryRequests, [{ url: '/api/v1/collections', authorization: 'Bearer new-token' }]);
});
