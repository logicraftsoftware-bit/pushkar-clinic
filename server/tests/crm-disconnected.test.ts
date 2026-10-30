import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
process.env.JWT_SECRET = 'crm-disconnection-test-secret-at-least-32-characters';
delete process.env.CRM_INTEGRATION_ENABLED;
const { pool } = await import('../src/db.js');
const { config } = await import('../src/config.js');
let queries = 0;
(pool as any).query = async () => { queries++; return { rows: [{ id: 'connection', is_active: true }] }; };
const { default: sync } = await import('../src/crm-integration.js');
const { default: admin } = await import('../src/super-admin.js');
const app = express();
app.use(express.json());
app.use('/sync', sync);
app.use('/admin', admin);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const token = jwt.sign({ sub: 'admin', role: 'super_admin' }, process.env.JWT_SECRET!);
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

test('CRM is disconnected by default and blocks sync and reconnect before database access', async () => {
  assert.equal(config.CRM_INTEGRATION_ENABLED, 'false');
  for (const [path, method] of [['/sync/bootstrap', 'POST'], ['/admin/crm-clinics', 'GET'], ['/admin/crm-connections', 'POST'], ['/admin/crm-connections/connection/status', 'PATCH']]) {
    const response = await fetch(base + path, { method, headers });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /temporarily disconnected/);
  }
  assert.equal(queries, 0);
});

test('saved connections remain visible but are reported as disconnected', async () => {
  const response = await fetch(base + '/admin/crm-connections', { headers });
  assert.equal(response.status, 200);
  const [connection] = await response.json();
  assert.equal(connection.id, 'connection');
  assert.equal(connection.integration_enabled, false);
  assert.equal(connection.is_active, false);
});

after(async () => { server.close(); await pool.end(); });
