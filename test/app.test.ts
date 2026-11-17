import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('GET /health returns 200 and JSON status', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('unknown routes use the contract error envelope', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/unknown' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});
