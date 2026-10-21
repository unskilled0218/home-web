import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { deferred, within } from './lifecycle.js';
import { rawAir, rawForecast } from './weather.js';

export const fixtureHosts = ['weather.invalid', 'sub.weather.invalid', 'wrong.invalid', 'api.open-meteo.com', 'air-quality-api.open-meteo.com', '127.0.0.1'];
export const proxyRuntime = { skip: process.allowedNodeEnvironmentFlags.has('--use-env-proxy') ? false : 'Requires Node with built-in environment proxy support (24.5+).' };

export async function weatherNetwork(t, { holdAir = false } = {}) {
  const directory = mkdtempSync('/tmp/opencode/weather-network-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cert = path.join(directory, 'cert.pem'); const key = path.join(directory, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=weather.invalid', '-addext', 'subjectAltName=DNS:weather.invalid,DNS:sub.weather.invalid,DNS:api.open-meteo.com,DNS:air-quality-api.open-meteo.com,IP:127.0.0.1'], { stdio: 'ignore' });
  const tls = { key: readFileSync(key), cert: readFileSync(cert) };
  const servers = []; const sockets = new Set(); const proxySockets = new Set(); const events = new EventEmitter(); const requests = []; const held = []; const airStarted = deferred();
  const track = (socket, set = sockets) => { set.add(socket); socket.on('error', () => {}); socket.once('close', () => { set.delete(socket); events.emit('socket-close'); }); };
  t.after(async () => { for (const socket of sockets) socket.destroy(); for (const socket of proxySockets) socket.destroy(); await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); });
  async function listen(server, proxy = false) {
    servers.push(server); server.on('connection', socket => track(socket, proxy ? proxySockets : sockets));
    server.listen(0, '127.0.0.1'); await within(once(server, 'listening'));
    return server.address().port;
  }
  function target(request, response) {
    const air = request.url.startsWith('/v1/air-quality');
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Keep-Alive', 'timeout=60');
    if (air && holdAir) { response.write('{'); held.push(response); airStarted.resolve(); return; }
    response.end(JSON.stringify(request.url.startsWith('/v1/forecast') ? rawForecast() : rawAir()));
  }
  const httpPort = await listen(http.createServer(target));
  const tlsServer = https.createServer(tls, target); tlsServer.keepAliveTimeout = 60000;
  const httpsPort = await listen(tlsServer);
  function destination(value, tunnel = false) {
    const url = new URL(tunnel ? `https://${value}` : value);
    assert.ok(fixtureHosts.includes(url.hostname), `Unexpected fixture destination: ${url.hostname}`);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    assert.ok([80, 443, httpPort, httpsPort].includes(port), 'Only declared fixture ports are permitted');
    return { url, port: tunnel ? httpsPort : httpPort };
  }
  async function proxy(secure = false) {
    const id = secure ? 'https-proxy' : 'http-proxy';
    const server = secure ? https.createServer(tls) : http.createServer();
    server.on('request', (request, response) => {
      try {
        const { url, port } = destination(request.url);
        requests.push({ id, method: request.method, hostname: url.hostname, port: url.port });
        const upstream = http.request({ hostname: '127.0.0.1', port, path: url.pathname + url.search, headers: request.headers, agent: false }, reply => { response.writeHead(reply.statusCode, reply.headers); reply.pipe(response); });
        upstream.on('socket', socket => track(socket)); upstream.on('error', () => { response.destroy(); }); request.pipe(upstream);
      } catch { response.writeHead(502); response.end(); }
    });
    server.on('connect', (request, client, head) => {
      try {
        const { url, port } = destination(request.url, true);
        requests.push({ id, method: 'CONNECT', hostname: url.hostname, port: url.port });
        // Native fetch may tunnel an HTTP destination too; preserve its actual protocol.
        const targetPort = Number(url.port) === httpPort || Number(url.port) === 80 ? httpPort : port;
        const upstream = net.connect({ host: '127.0.0.1', port: targetPort }); track(upstream);
        upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
        client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
      } catch { client.destroy(); }
    });
    return `${secure ? 'https' : 'http'}://127.0.0.1:${await listen(server, true)}`;
  }
  const httpProxy = await proxy(); const httpsProxy = await proxy(true);
  return {
    cert, httpProxy, httpsProxy, requests, proxySockets, airStarted: airStarted.promise,
    httpUrl: `http://weather.invalid:${httpPort}/air`, httpsUrl: `https://weather.invalid:${httpsPort}/air`,
    releaseAir() { for (const response of held) response.end(JSON.stringify(rawAir()).slice(1)); },
    waitForProxyClose() { return within((async () => { while (proxySockets.size) await once(events, 'socket-close'); })(), 1500); },
    get openProxyConnections() { return proxySockets.size; }
  };
}

export function weatherClient(t, config, { env = {}, args = [], ca } = {}) {
  const child = spawn(process.execPath, [...args, new URL('./weather-network-client.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, ...env, ...(ca && { NODE_EXTRA_CA_CERTS: ca }), WEATHER_NETWORK_CASE: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const events = new EventEmitter(); const messages = []; let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', message => { messages.push(message); events.emit(message.type, message); });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  t.after(async () => {
    if (child.connected) child.send({ type: 'exit' });
    const result = await within(closed, 15000); assert.equal(result.code, 0, stderr + stdout); assert.equal(result.signal, null);
  });
  return {
    send: type => child.send({ type }),
    get alive() { return child.exitCode === null && child.signalCode === null && child.connected; },
    async wait(type) {
      const existing = messages.find(message => message.type === type); if (existing) return existing;
      return within(Promise.race([once(events, type).then(([message]) => message), closed.then(result => { throw new Error(`Client exited before ${type}: ${JSON.stringify(result)} ${stderr} ${stdout}`); })]), 7000);
    }
  };
}
