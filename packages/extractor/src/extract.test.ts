import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServiceManifest } from '@codegraph/schema';
import { validateManifest } from '@codegraph/schema';
import { extract } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '..', '..', '..', 'samples');

const cache = new Map<string, Promise<ServiceManifest>>();
function manifest(name: string): Promise<ServiceManifest> {
  let p = cache.get(name);
  if (!p) {
    p = extract(path.join(samples, name), { includeCommit: false }).then((r) => r.manifest);
    cache.set(name, p);
  }
  return p;
}

function endpoint(m: ServiceManifest, id: string) {
  const e = m.endpoints.find((x) => x.id === id);
  assert.ok(e, `endpoint ${id} not found in ${m.service.id}; have ${m.endpoints.map((x) => x.id).join(', ')}`);
  return e;
}

function call(m: ServiceManifest, pred: (c: ServiceManifest['calls'][number]) => boolean, label: string) {
  const c = m.calls.find(pred);
  assert.ok(c, `call ${label} not found in ${m.service.id}; have ${m.calls.map((x) => x.id).join(' | ')}`);
  return c;
}

/** Transitive closure of handler calls starting from a handler id. */
function reachable(m: ServiceManifest, from: string): Set<string> {
  const byId = new Map(m.handlers.map((h) => [h.id, h]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of byId.get(id)?.calls ?? []) stack.push(c);
  }
  return seen;
}

test('every sample produces a valid manifest', async () => {
  for (const name of ['web-ui', 'orders-experience-api', 'catalog-experience-api', 'orders-capability-api', 'inventory-domain-api', 'payments-domain-api', 'customers-domain-api', 'products-domain-api', 'notification-processor', 'analytics-worker']) {
    const m = await manifest(name);
    assert.deepEqual(validateManifest(m), [], name);
    assert.equal(m.service.id, name);
    assert.notEqual(m.service.layer, 'unknown', `${name} layer`);
  }
});

test('web-ui: fetch and axios instance calls resolve to experience APIs', async () => {
  const m = await manifest('web-ui');
  assert.equal(m.service.layer, 'ui');
  assert.equal(m.endpoints.length, 0);
  const place = call(m, (c) => c.method === 'POST' && c.url.endsWith('/v1/orders'), 'POST /v1/orders');
  assert.equal(place.targetHint, 'VITE_ORDERS_EXP_URL');
  assert.equal(place.targetService, 'orders-experience-api');
  const status = call(m, (c) => c.url.includes('/v1/orders/{id}/status'), 'order status');
  assert.equal(status.targetService, 'orders-experience-api');
  const products = call(m, (c) => c.url === '/v1/catalog/products', 'catalog products');
  assert.equal(products.targetHint, 'VITE_CATALOG_EXP_URL');
  assert.equal(products.targetService, 'catalog-experience-api');
  assert.ok(m.handlers.every((h) => h.kind === 'client'));
});

test('orders-experience-api: NestJS routes, axios instance targets and controller -> service -> client chain', async () => {
  const m = await manifest('orders-experience-api');
  assert.equal(m.service.layer, 'experience');
  assert.ok(m.service.frameworks?.includes('nestjs'));
  assert.deepEqual(
    m.endpoints.map((e) => e.id).sort(),
    ['GET /v1/orders/{id}', 'GET /v1/orders/{id}/status', 'POST /v1/orders'],
  );
  const create = endpoint(m, 'POST /v1/orders');
  assert.equal(create.handler, 'OrdersController.create');
  const cap = call(m, (c) => c.method === 'POST' && c.url === '/api/orders', 'POST /api/orders');
  assert.equal(cap.targetHint, 'ORDERS_CAP_URL');
  assert.equal(cap.targetService, 'orders-capability-api');
  const cust = call(m, (c) => c.url === '/customers/{id}', 'GET /customers/{id}');
  assert.equal(cust.targetService, 'customers-domain-api');
  const reach = reachable(m, create.handler);
  assert.ok(reach.has('OrdersService.placeOrder'));
  assert.ok(reach.has(cap.fromHandler), 'create reaches capability call');
  assert.ok(reach.has(cust.fromHandler), 'create reaches customers call');
  assert.equal(m.publishes.length, 0);
});

test('catalog-experience-api: express router mount prefix and fetch with env base', async () => {
  const m = await manifest('catalog-experience-api');
  const list = endpoint(m, 'GET /v1/catalog/products');
  endpoint(m, 'GET /v1/catalog/products/{id}');
  endpoint(m, 'GET /healthz');
  const products = call(m, (c) => c.url === '{PRODUCTS_BASE}/products', 'products list');
  assert.equal(products.targetHint, 'PRODUCTS_API_URL');
  assert.equal(products.targetService, 'products-domain-api');
  assert.ok(reachable(m, list.handler).has(products.fromHandler));
});

test('orders-capability-api: attribute routes, named/typed HttpClient targets, Kafka publishes with constant topics', async () => {
  const m = await manifest('orders-capability-api');
  assert.equal(m.service.language, 'csharp');
  assert.ok(m.service.frameworks?.includes('aspnetcore'));
  const create = endpoint(m, 'POST /api/Orders');
  endpoint(m, 'GET /api/Orders/{id}');
  const cancel = endpoint(m, 'POST /api/Orders/{id}/cancel');
  endpoint(m, 'GET /health');
  assert.equal(create.handler, 'OrdersController.Create');

  const reserve = call(m, (c) => c.url === '/inventory/reserve', 'inventory reserve');
  assert.equal(reserve.method, 'POST');
  assert.equal(reserve.targetHint, 'Services:Inventory:BaseUrl');
  assert.equal(reserve.targetService, 'inventory-domain-api');
  assert.equal(reserve.fromHandler, 'OrderService.Place');

  const authorize = call(m, (c) => c.url === '/payments/authorize', 'payments authorize');
  assert.equal(authorize.targetHint, 'Services:Payments:BaseUrl');
  assert.equal(authorize.targetService, 'payments-domain-api');
  assert.equal(authorize.fromHandler, 'PaymentsClient.Authorize');

  const created = m.publishes.find((p) => p.topic === 'order.created');
  const cancelled = m.publishes.find((p) => p.topic === 'order.cancelled');
  assert.ok(created && created.broker === 'kafka');
  assert.ok(cancelled && cancelled.broker === 'kafka');

  // Create -> Place -> inventory call, payments call, order.created publish
  const reach = reachable(m, create.handler);
  assert.ok(reach.has('OrderService.Place'));
  assert.ok(reach.has(reserve.fromHandler));
  assert.ok(reach.has(authorize.fromHandler));
  assert.ok(reach.has(created!.fromHandler));
  // Cancel -> release + order.cancelled, but not authorize
  const cancelReach = reachable(m, cancel.handler);
  assert.ok(cancelReach.has(cancelled!.fromHandler));
  assert.ok(!cancelReach.has(authorize.fromHandler));
  assert.ok(m.handlers.find((h) => h.id === 'PaymentsClient.Authorize')?.kind === 'client');
  assert.ok(m.handlers.every((h) => h.hash && h.hash.length === 16));
});

test('inventory-domain-api: Spring mappings, @KafkaListener, RestTemplate with @Value base url', async () => {
  const m = await manifest('inventory-domain-api');
  assert.equal(m.service.language, 'java');
  const get = endpoint(m, 'GET /inventory/{sku}');
  endpoint(m, 'POST /inventory/reserve');
  endpoint(m, 'POST /inventory/release');
  const consumer = m.consumers.find((c) => c.topic === 'order.cancelled');
  assert.ok(consumer && consumer.broker === 'kafka' && consumer.group === 'inventory');
  assert.equal(consumer.handler, 'OrderCancelledListener.onOrderCancelled');
  const stock = call(m, (c) => c.url.includes('/v2/stock/{sku}') && c.method === 'GET', 'wms stock');
  assert.equal(stock.targetHint, 'wms.base-url');
  assert.equal(stock.targetService, 'wms-vendor');
  const adjust = call(m, (c) => c.url.startsWith('https://api.wms-vendor.com/'), 'wms adjust');
  assert.equal(adjust.targetHint, 'api.wms-vendor.com');
  assert.ok(reachable(m, get.handler).has(stock.fromHandler));
  assert.ok(reachable(m, consumer.handler).has(adjust.fromHandler));
});

test('payments-domain-api: Feign client calls and RabbitMQ publishes with exchange + routing key', async () => {
  const m = await manifest('payments-domain-api');
  const authorize = endpoint(m, 'POST /payments/authorize');
  const stripe = call(m, (c) => c.url === 'https://api.stripe.com/v1/payment_intents', 'stripe create');
  assert.equal(stripe.method, 'POST');
  assert.equal(stripe.targetHint, 'api.stripe.com');
  assert.equal(stripe.targetService, 'stripe');
  assert.equal(stripe.fromHandler, 'StripeClient.createPaymentIntent');
  const pub = m.publishes.find((p) => p.routingKey === 'payment.authorized');
  assert.ok(pub && pub.broker === 'rabbitmq' && pub.topic === 'payments');
  assert.ok(reachable(m, authorize.handler).has(stripe.fromHandler));
  assert.ok(reachable(m, authorize.handler).has(pub.fromHandler));
});

test('customers-domain-api: minimal APIs with MapGroup prefix', async () => {
  const m = await manifest('customers-domain-api');
  assert.deepEqual(m.endpoints.map((e) => e.id).sort(), ['GET /customers/{id}', 'GET /health', 'PUT /customers/{id}']);
});

test('products-domain-api: plain JavaScript express routes', async () => {
  const m = await manifest('products-domain-api');
  assert.equal(m.service.language, 'javascript');
  endpoint(m, 'GET /products');
  endpoint(m, 'GET /products/{id}');
});

test('notification-processor: Confluent subscribe, RabbitMQ bind+consume, typed client and external call', async () => {
  const m = await manifest('notification-processor');
  assert.equal(m.service.layer, 'processor');
  const kafka = m.consumers.find((c) => c.broker === 'kafka');
  assert.ok(kafka && kafka.topic === 'order.created');
  const rabbit = m.consumers.find((c) => c.broker === 'rabbitmq');
  assert.ok(rabbit);
  assert.equal(rabbit.topic, 'notifications.payment');
  assert.equal(rabbit.exchange, 'payments');
  assert.equal(rabbit.routingKey, 'payment.authorized');
  const customers = call(m, (c) => c.url === '/customers/{id}', 'customers');
  assert.equal(customers.targetHint, 'Services:Customers:BaseUrl');
  assert.equal(customers.targetService, 'customers-domain-api');
  const sendgrid = call(m, (c) => c.url.startsWith('https://api.sendgrid.com'), 'sendgrid');
  assert.equal(sendgrid.targetService, 'sendgrid');
  assert.ok(reachable(m, kafka.handler).has(customers.fromHandler));
  assert.ok(reachable(m, kafka.handler).has(sendgrid.fromHandler));
  assert.ok(reachable(m, rabbit.handler).has(sendgrid.fromHandler), 'rabbit consumer reaches sendgrid via lambda');
});

test('analytics-worker: kafkajs subscribe with imported constants, eachMessage handler publishes', async () => {
  const m = await manifest('analytics-worker');
  assert.deepEqual(m.consumers.map((c) => c.topic).sort(), ['order.cancelled', 'order.created']);
  assert.ok(m.consumers.every((c) => c.group === 'analytics'));
  const pub = m.publishes.find((p) => p.topic === 'analytics.order-metrics');
  assert.ok(pub && pub.broker === 'kafka');
  assert.equal(pub.fromHandler, m.consumers[0].handler, 'publish happens inside the eachMessage handler');
});

test('config overrides and inference', async () => {
  const r = await extract(path.join(samples, 'products-domain-api'), { includeCommit: false, serviceId: 'override-id', layer: 'capability' });
  assert.equal(r.manifest.service.id, 'override-id');
  assert.equal(r.manifest.service.layer, 'capability');
  assert.ok(r.plugins.includes('express'));
});
