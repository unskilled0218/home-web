import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, symlinkSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { rootCertificates } from 'node:tls';
import { within } from './fixtures/lifecycle.js';

const root = path.resolve(import.meta.dirname, '..');
const clientModule = pathToFileURL(path.join(root, 'src/home-assistant.js')).href;

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function handleFrames(socket) {
  let buffered = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const masked = Boolean(buffered[1] & 0x80);
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) { if (buffered.length < 4) return; length = buffered.readUInt16BE(2); offset = 4; }
      if (length === 127) return socket.destroy();
      const required = offset + (masked ? 4 : 0) + length;
      if (buffered.length < required) return;
      const opcode = buffered[0] & 0x0f;
      let payload;
      if (masked) {
        const mask = buffered.subarray(offset, offset + 4);
        offset += 4;
        payload = Buffer.from(buffered.subarray(offset, offset + length));
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      } else payload = buffered.subarray(offset, offset + length);
      buffered = buffered.subarray(required);
      if (opcode === 8) { socket.end(); return; }
      if (opcode !== 1) continue;
      const message = JSON.parse(payload.toString('utf8'));
      if (message.type === 'auth') socket.write(frame({ type: 'auth_ok' }));
      if (message.id === 1) socket.write(frame({ id: 1, type: 'result', success: true, result: [{ id: 'lamp', name: 'Lamp', area_id: 'office' }] }));
      if (message.id === 2) socket.write(frame({ id: 2, type: 'result', success: true, result: [{ area_id: 'office', name: 'Office' }] }));
      if (message.id === 3) socket.write(frame({ id: 3, type: 'result', success: true, result: { entities: [{ ei: 'light.lamp', di: 'lamp', en: 'Lamp' }, { ei: 'sensor.temperature', di: 'lamp', en: 'Temperature' }] } }));
      if (message.id === 4) socket.write(frame({ id: 4, type: 'result', success: true, result: [{ entity_id: 'light.lamp', state: 'off', attributes: { friendly_name: 'Lamp' } }, { entity_id: 'sensor.temperature', state: '22.5', attributes: { friendly_name: 'Temperature', unit_of_measurement: '°C', device_class: 'temperature' } }] }));
    }
  });
}

function createWebSocketServer(certificatePath, keyPath) {
  const sockets = new Set();
  const server = https.createServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    if (request.url !== '/api/websocket' || !request.headers['sec-websocket-key']) return socket.destroy();
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    handleFrames(socket);
    socket.write(frame({ type: 'auth_required' }));
  });
  return { server, destroySockets: () => { for (const socket of sockets) socket.destroy(); } };
}

async function runClient(baseUrl, caFile) {
  const source = `import { createHomeAssistantClient } from ${JSON.stringify(clientModule)};
import { loadScopedCa } from ${JSON.stringify(new URL('../src/ca-file.js', import.meta.url).href)};
import https from 'node:https';
const deadline = setTimeout(() => process.exit(2), 4500);
const ca = await loadScopedCa(process.env.HOME_ASSISTANT_CA_FILE, 'HOME_ASSISTANT_CA_FILE');
const client = createHomeAssistantClient({ timeoutMs: 2000, ca });
try {
  const settings = { baseUrl: process.env.TEST_HOME_ASSISTANT_URL, accessToken: 'test-token' };
  const devices = await client.listDevices(settings);
  await client.controlEntity(settings, { domain: 'light', entityId: 'light.lamp' }, 'turn_on');
  if (ca) {
    const code = await new Promise(resolve => { const request = https.get(settings.baseUrl, response => { response.resume(); resolve('trusted'); }); request.on('error', error => resolve(error.code)); request.setTimeout(1000, () => request.destroy()); });
    if (!['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(code)) throw new Error('Home Assistant CA leaked into unrelated HTTPS trust: ' + code);
  }
  process.stdout.write(JSON.stringify({ ok: true, devices }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error.message }));
} finally { await client.dispose(); clearTimeout(deadline); }`;
  const environment = { ...process.env, TEST_HOME_ASSISTANT_URL: baseUrl };
  delete environment.NODE_EXTRA_CA_CERTS;
  delete environment.NODE_TLS_REJECT_UNAUTHORIZED;
  delete environment.HOME_ASSISTANT_CA_FILE;
  if (caFile) environment.HOME_ASSISTANT_CA_FILE = caFile;
  const child = spawn(process.execPath, ['--dns-result-order=ipv4first', '--input-type=module', '--eval', source], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

async function verifyDevelopmentReload(baseUrl, caFile) {
  const directory = mkdtempSync('/tmp/opencode/ha-trust-reload-'); let child; let exited;
  try {
    for (const folder of ['src', 'public', 'scripts']) cpSync(path.join(root, folder), path.join(directory, folder), { recursive: true });
    cpSync(path.join(root, 'package.json'), path.join(directory, 'package.json')); symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const values = `HOST=127.0.0.1\nPORT=${port}\nDATABASE_PATH=${directory}/db.sqlite\nNFS_MOUNT_MODE=disabled\n`;
    writeFileSync(path.join(directory, '.env'), values);
    child = spawn(process.execPath, ['scripts/dev.js'], { cwd: directory, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); exited = once(child, 'exit');
    let ready = 0; let errors = ''; child.stdout.on('data', chunk => { if (chunk.toString().includes('dashboard listening')) ready++; }); child.stderr.on('data', chunk => { errors += chunk; });
    const waitReady = async count => { const until = Date.now() + 4000; while (ready < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25)); assert.ok(ready >= count, errors); };
    await waitReady(1);
    const connect = () => fetch(`http://127.0.0.1:${port}/api/home-assistant`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: baseUrl, accessToken: 'test-token' }), signal: AbortSignal.timeout(2500) });
    assert.equal((await connect()).status, 400, 'no Home Assistant private trust initially');
    writeFileSync(path.join(directory, '.env'), values + `HOME_ASSISTANT_CA_FILE=${caFile}\n`); await waitReady(2);
    assert.equal((await connect()).status, 200, 'new child trusts HOME_ASSISTANT_CA_FILE from env file');
    writeFileSync(path.join(directory, '.env'), values); await waitReady(3);
    const result = await fetch(`http://127.0.0.1:${port}/api/home-assistant/devices?controls=0&refresh=1`, { signal: AbortSignal.timeout(2500) });
    assert.equal(result.status, 503, 'removing CA restores rejection without pinning trust');
    assert.match((await result.json()).error, /HOME_ASSISTANT_CA_FILE|certificate/, 'trust failure remains actionable');
    const status = await (await fetch(`http://127.0.0.1:${port}/api/home-assistant`)).json(); assert.equal(status.homeAssistant.configured, true, 'failed trust does not delete encrypted credentials');
  } finally {
    if (child && child.exitCode === null) child.send({ type: 'dashboard:shutdown' });
    if (exited) await within(exited, 5000);
    rmSync(directory, { recursive: true, force: true });
  }
}

test('trusts a configured private CA while preserving hostname verification', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-home-assistant-tls-'));
  const caCertificate = path.join(directory, 'ca.pem');
  const caKey = path.join(directory, 'ca-key.pem');
  const serverCertificate = path.join(directory, 'server.pem');
  const serverKey = path.join(directory, 'server-key.pem');
  const request = path.join(directory, 'server.csr');
  const extensions = path.join(directory, 'server.ext');
  let fixture;
  try {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caCertificate, '-days', '1', '-subj', '/CN=Dashboard Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'ignore' });
      execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', serverKey, '-out', request, '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
      writeFileSync(extensions, 'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
      execFileSync('openssl', ['x509', '-req', '-in', request, '-CA', caCertificate, '-CAkey', caKey, '-CAcreateserial', '-out', serverCertificate, '-days', '1', '-extfile', extensions], { stdio: 'ignore' });
    } catch (error) {
      context.skip(`OpenSSL is required for the Home Assistant TLS test: ${error.message}`);
      return;
    }
    fixture = createWebSocketServer(serverCertificate, serverKey);
    fixture.server.listen(0, '127.0.0.1');
    await once(fixture.server, 'listening');
    const port = fixture.server.address().port;

    const untrusted = await runClient(`https://127.0.0.1:${port}`);
    assert.equal(untrusted.ok, false);
    assert.match(untrusted.message, /(?:connection failed|not trusted).*HOME_ASSISTANT_CA_FILE/);

    const wrongCa = path.join(directory, 'wrong-ca.pem'); writeFileSync(wrongCa, rootCertificates[0]);
    assert.equal((await runClient(`https://127.0.0.1:${port}`, wrongCa)).ok, false, 'unrelated valid CA does not establish private trust');

    const trusted = await runClient(`https://127.0.0.1:${port}`, caCertificate);
    assert.deepEqual(trusted, { ok: true, devices: [{ deviceId: 'lamp', name: 'Lamp', area: 'Office', disabled: false, measurements: [{ entityId: 'sensor.temperature', name: 'Temperature', value: '22.5', status: 'available', available: true, unit: '°C', deviceClass: 'temperature' }], controls: [{ entityId: 'light.lamp', domain: 'light', name: 'Lamp', state: 'off' }] }] });

    const wrongHostname = await runClient(`https://localhost:${port}`, caCertificate);
    assert.equal(wrongHostname.ok, false);
    assert.match(wrongHostname.message, /(?:connection failed.*HOME_ASSISTANT_CA_FILE|does not match.*hostname)/);
    await verifyDevelopmentReload(`https://127.0.0.1:${port}`, caCertificate);
  } finally {
    fixture?.destroySockets();
    if (fixture?.server.listening) await new Promise((resolve) => fixture.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
