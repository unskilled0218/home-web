import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

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
      if (message.id === 3) socket.write(frame({ id: 3, type: 'result', success: true, result: { entities: [{ ei: 'light.lamp', di: 'lamp', en: 'Lamp' }] } }));
      if (message.id === 4) socket.write(frame({ id: 4, type: 'result', success: true, result: [{ entity_id: 'light.lamp', state: 'off', attributes: { friendly_name: 'Lamp' } }] }));
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
try {
  const devices = await createHomeAssistantClient({ timeoutMs: 2000 }).listDevices({ baseUrl: process.env.TEST_HOME_ASSISTANT_URL, accessToken: 'test-token' });
  process.stdout.write(JSON.stringify({ ok: true, devices }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error.message }));
}`;
  const environment = { ...process.env, TEST_HOME_ASSISTANT_URL: baseUrl };
  delete environment.NODE_EXTRA_CA_CERTS;
  delete environment.NODE_TLS_REJECT_UNAUTHORIZED;
  if (caFile) environment.NODE_EXTRA_CA_CERTS = caFile;
  const child = spawn(process.execPath, ['--dns-result-order=ipv4first', '--input-type=module', '--eval', source], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
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
    assert.match(untrusted.message, /connection failed.*NODE_EXTRA_CA_CERTS/);

    const trusted = await runClient(`https://127.0.0.1:${port}`, caCertificate);
    assert.deepEqual(trusted, { ok: true, devices: [{ deviceId: 'lamp', name: 'Lamp', area: 'Office', disabled: false, controls: [{ entityId: 'light.lamp', domain: 'light', name: 'Lamp', state: 'off' }] }] });

    const wrongHostname = await runClient(`https://localhost:${port}`, caCertificate);
    assert.equal(wrongHostname.ok, false);
    assert.match(wrongHostname.message, /connection failed.*NODE_EXTRA_CA_CERTS/);
  } finally {
    fixture?.destroySockets();
    if (fixture?.server.listening) await new Promise((resolve) => fixture.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
