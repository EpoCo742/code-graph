import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServiceManifest } from '@codegraph/schema';
import { aggregate } from './index.js';
import { normalisePath, parseCallUrl, pathMatches } from './paths.js';

const loc = { file: 'x', line: 1 };

function manifest(partial: Partial<ServiceManifest> & { service: ServiceManifest['service'] }): ServiceManifest {
  return {
    schemaVersion: '1',
    generatedAt: '2026-01-01T00:00:00Z',
    endpoints: [],
    consumers: [],
    calls: [],
    publishes: [],
    handlers: [],
    ...partial,
  };
}

const ui = manifest({
  service: { id: 'web-ui', name: 'Web UI', layer: 'ui' },
  handlers: [{ id: 'OrdersPage.submit', kind: 'client', name: 'OrdersPage.submit', location: loc, calls: [] }],
  calls: [{ id: 'c1', method: 'POST', url: '{import.meta.env.VITE_ORDERS_EXP_URL}/v1/orders', targetHint: 'VITE_ORDERS_EXP_URL', fromHandler: 'OrdersPage.submit', location: loc }],
});

const exp = manifest({
  service: { id: 'orders-experience-api', name: 'Orders Experience API', layer: 'experience' },
  handlers: [
    { id: 'OrdersController.create', kind: 'http', name: 'OrdersController.create', location: loc, calls: ['OrdersService.create'] },
    { id: 'OrdersService.create', kind: 'service', name: 'OrdersService.create', location: loc, calls: [] },
  ],
  endpoints: [{ id: 'POST /v1/orders', method: 'POST', path: '/v1/orders', handler: 'OrdersController.create', location: loc }],
  calls: [{ id: 'c1', method: 'POST', url: '{base}/api/orders', targetHint: 'ORDERS_CAP_URL', fromHandler: 'OrdersService.create', location: loc }],
});

const cap = manifest({
  service: { id: 'orders-capability-api', name: 'Orders Capability API', layer: 'capability' },
  handlers: [
    { id: 'OrdersController.Create', kind: 'http', name: 'OrdersController.Create', location: loc, calls: ['OrderService.Place'] },
    { id: 'OrderService.Place', kind: 'service', name: 'OrderService.Place', location: loc, calls: [] },
  ],
  endpoints: [{ id: 'POST /api/orders', method: 'POST', path: '/api/orders', handler: 'OrdersController.Create', location: loc }],
  calls: [
    { id: 'c1', method: 'POST', url: '/inventory/reserve', targetHint: 'inventory', fromHandler: 'OrderService.Place', location: loc },
    { id: 'c2', method: 'POST', url: 'https://api.stripe.com/v1/charges', fromHandler: 'OrderService.Place', location: loc },
  ],
  publishes: [{ id: 'p1', broker: 'kafka', topic: 'order.created', fromHandler: 'OrderService.Place', location: loc }],
});

const inv = manifest({
  service: { id: 'inventory-domain-api', name: 'Inventory Domain API', layer: 'domain' },
  handlers: [{ id: 'InventoryController.reserve', kind: 'http', name: 'InventoryController.reserve', location: loc, calls: [] }],
  endpoints: [{ id: 'POST /inventory/reserve', method: 'POST', path: '/inventory/reserve', handler: 'InventoryController.reserve', location: loc }],
});

const notif = manifest({
  service: { id: 'notification-processor', name: 'Notification Processor', layer: 'processor' },
  handlers: [{ id: 'OrderCreatedHandler.Handle', kind: 'message', name: 'OrderCreatedHandler.Handle', location: loc, calls: [] }],
  consumers: [{ id: 'k1', broker: 'kafka', topic: 'order.created', handler: 'OrderCreatedHandler.Handle', location: loc }],
  calls: [{ id: 'c1', method: 'POST', url: 'https://api.sendgrid.com/v3/mail/send', fromHandler: 'OrderCreatedHandler.Handle', location: loc }],
});

const all = [ui, exp, cap, inv, notif];

test('path helpers', () => {
  assert.equal(normalisePath('api/orders/:id/'), '/api/orders/{p}');
  assert.equal(normalisePath('/api/[controller]/{id:int}'), '/api/[controller]/{p}');
  assert.deepEqual(parseCallUrl('https://api.stripe.com:443/v1/charges?x=1'), { host: 'api.stripe.com', path: '/v1/charges', dynamicPrefix: false });
  assert.deepEqual(parseCallUrl('{base}/orders/{id}'), { host: undefined, path: '/orders/{p}', dynamicPrefix: true });
  assert.ok(pathMatches('/orders/{p}', '/api/orders/{p}'));
  assert.ok(!pathMatches('/orders/{p}', '/api/orders'));
});

test('resolves via config targets, hints, path and literal host', () => {
  const g = aggregate(all, { config: { targets: { VITE_ORDERS_EXP_URL: 'orders-experience-api', ORDERS_CAP_URL: 'orders-capability-api', 'api.stripe.com': 'external:stripe' }, externals: { stripe: { name: 'Stripe' } } } });
  const http = g.edges.filter((e) => e.kind === 'http').map((e) => `${e.source}->${e.target}:${e.resolution}`);
  assert.ok(http.includes('web-ui->orders-experience-api:config'));
  assert.ok(http.includes('orders-experience-api->orders-capability-api:config'));
  assert.ok(http.includes('orders-capability-api->inventory-domain-api:hint'));
  assert.ok(http.includes('orders-capability-api->external:stripe:config'));
  assert.ok(http.includes('notification-processor->external:api.sendgrid.com:literal-host'));
  const stripe = g.nodes.find((n) => n.id === 'external:stripe');
  assert.equal(stripe?.kind === 'service' && stripe.name, 'Stripe');
  const detail = g.edges.find((e) => e.kind === 'http-detail' && e.source === 'orders-experience-api#OrdersService.create');
  assert.equal(detail?.endpoint, 'orders-capability-api#POST /api/orders');
  assert.equal(g.issues.filter((i) => i.code === 'call:unresolved').length, 0);
});

test('messaging edges and topic nodes', () => {
  const g = aggregate(all);
  assert.ok(g.nodes.some((n) => n.id === 'topic:kafka:order.created'));
  assert.ok(g.edges.some((e) => e.kind === 'publish' && e.source === 'orders-capability-api' && e.target === 'topic:kafka:order.created'));
  assert.ok(g.edges.some((e) => e.kind === 'consume' && e.source === 'topic:kafka:order.created' && e.target === 'notification-processor'));
});

test('derives an end-to-end flow from the UI through to the processor', () => {
  const g = aggregate(all, { config: { targets: { VITE_ORDERS_EXP_URL: 'orders-experience-api', ORDERS_CAP_URL: 'orders-capability-api' } } });
  const f = g.flows.find((f) => f.entry.service === 'web-ui');
  assert.ok(f, 'ui flow exists');
  const services = f!.steps.map((s) => s.service);
  assert.deepEqual(services, ['web-ui', 'orders-experience-api', 'orders-capability-api', 'inventory-domain-api', 'external:api.stripe.com', 'orders-capability-api', 'notification-processor', 'external:api.sendgrid.com']);
  // non-root endpoints do not get their own flow by default
  assert.ok(!g.flows.some((f) => f.entry.ref === 'orders-capability-api#POST /api/orders'));
  const g2 = aggregate(all, { config: { flows: { includeNonRoots: true } } });
  assert.ok(g2.flows.some((f) => f.entry.ref === 'orders-capability-api#POST /api/orders'));
});

test('unresolved calls become issues, traces mark drift', () => {
  const lonely = manifest({
    service: { id: 'lonely', name: 'Lonely', layer: 'domain' },
    handlers: [{ id: 'A.b', kind: 'service', name: 'A.b', location: loc, calls: [] }],
    calls: [{ id: 'c', url: '{x}/nowhere', fromHandler: 'A.b', location: loc }],
  });
  const g = aggregate([...all, lonely], { observed: [{ source: 'orders-capability-api', target: 'inventory-domain-api' }, { source: 'lonely', target: 'web-ui' }] });
  assert.ok(g.issues.some((i) => i.code === 'call:unresolved' && i.service === 'lonely'));
  const both = g.edges.find((e) => e.kind === 'http' && e.source === 'orders-capability-api' && e.target === 'inventory-domain-api');
  assert.equal(both?.status, 'both');
  const obs = g.edges.find((e) => e.kind === 'http' && e.source === 'lonely' && e.target === 'web-ui');
  assert.equal(obs?.status, 'observed');
  assert.ok(g.issues.some((i) => i.code === 'drift:observed-only'));
});

test('manifest diff reports added endpoints and new dependencies', async () => {
  const { diffManifests, diffToMarkdown } = await import('./diff.js');
  const after: ServiceManifest = { ...cap, endpoints: [...cap.endpoints, { id: 'GET /api/orders/{id}', method: 'GET', path: '/api/orders/{p}', handler: 'OrdersController.Create', location: loc }] };
  const d = diffManifests(cap, after);
  assert.deepEqual(d.endpoints.added, ['GET /api/orders/{p}']);
  assert.equal(d.newDependencies, false);
  const fresh = diffManifests(undefined, cap);
  assert.equal(fresh.newDependencies, true);
  assert.ok(diffToMarkdown(fresh).includes('new outbound dependency'));
});
