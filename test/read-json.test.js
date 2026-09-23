import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { MAX_JSON_BODY_BYTES, readJson } from '../src/app.js';

test('decodes a multibyte UTF-8 character split across request chunks', async () => {
  const body = Buffer.from('{"name":"café"}');
  const split = body.indexOf(Buffer.from('é')) + 1;
  assert.deepEqual(await readJson(Readable.from([body.subarray(0, split), body.subarray(split)])), { name: 'café' });
});

test('enforces the JSON request limit in bytes at the exact boundary', async () => {
  const prefix = Buffer.from('{"value":"');
  const suffix = Buffer.from('"}');
  const exact = Buffer.concat([prefix, Buffer.alloc(MAX_JSON_BODY_BYTES - prefix.length - suffix.length, 97), suffix]);
  assert.equal(exact.length, MAX_JSON_BODY_BYTES);
  assert.equal((await readJson(Readable.from([exact]))).value.length, MAX_JSON_BODY_BYTES - prefix.length - suffix.length);
  await assert.rejects(readJson(Readable.from([Buffer.concat([exact, Buffer.from(' ')])])), /too large/);

  const multibyte = Buffer.from(`{"value":"${'é'.repeat(MAX_JSON_BODY_BYTES / 2)}"}`);
  assert.ok(multibyte.toString('utf8').length < MAX_JSON_BODY_BYTES);
  await assert.rejects(readJson(Readable.from([multibyte])), /too large/);
});
