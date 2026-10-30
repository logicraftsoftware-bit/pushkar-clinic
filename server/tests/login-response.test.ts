import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginRequest, readJsonResponse } from '../../src/http-response.js';

test('HTML gateway failures and SPA fallbacks show service errors without exposing HTML', async () => {
  await assert.rejects(readJsonResponse(new Response('<!DOCTYPE html><h1>Bad Gateway</h1>', {status:502})), /temporarily unavailable.*502/);
  await assert.rejects(readJsonResponse(new Response('<!DOCTYPE html>')), /unexpected response/);
  assert.deepEqual(await readJsonResponse(Response.json({error:'Invalid credentials'}, {status:401})), {error:'Invalid credentials'});
});

test('login handles network failures and timeouts and sends credentials as JSON', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.method, 'POST');
      assert.equal(JSON.parse(String(options?.body)).identifier, 'tester');
      assert.ok(options?.signal);
      return Response.json({token:'test-token'});
    };
    assert.equal((await loginRequest('/login', {identifier:'tester'})).result.token, 'test-token');
    globalThis.fetch = async () => { throw new DOMException('Timeout', 'TimeoutError'); };
    await assert.rejects(loginRequest('/login', {}), /Sign in timed out.*Account registration and password could not be checked.*LOGIN_REQUEST_TIMEOUT/);
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(loginRequest('/login', {}), /Unable to reach the server/);
  } finally { globalThis.fetch = original; }
});
