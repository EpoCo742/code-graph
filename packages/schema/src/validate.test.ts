import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from './validate.js';

const base = {
  schemaVersion: '1',
  service: { id: 'orders-api', name: 'Orders API', layer: 'capability' },
  generatedAt: new Date().toISOString(),
  handlers: [{ id: 'OrdersController.Get', kind: 'http', name: 'OrdersController.Get', location: { file: 'a.cs', line: 1 }, calls: [] }],
  endpoints: [{ id: 'GET /orders/{id}', method: 'GET', path: '/orders/{id}', handler: 'OrdersController.Get', location: { file: 'a.cs', line: 1 } }],
  consumers: [],
  calls: [],
  publishes: [],
};

test('valid manifest passes', () => {
  assert.deepEqual(validateManifest(base), []);
});

test('unknown handler reference fails', () => {
  const bad = { ...base, endpoints: [{ ...base.endpoints[0], handler: 'nope' }] };
  assert.ok(validateManifest(bad).some((e) => e.path === 'endpoints[0].handler'));
});

test('bad layer fails', () => {
  const bad = { ...base, service: { ...base.service, layer: 'middle' } };
  assert.ok(validateManifest(bad).some((e) => e.path === 'service.layer'));
});
