import type { EndpointNode, Flow, Graph, GraphEdge, GraphNode, HandlerNode, Layer, ServiceNode, TopicNode } from '@codegraph/schema';

/**
 * Hand-built demo graph used with `?demo=1`. It mirrors the sample estate in
 * /samples so the UI can be exercised before the extractor and aggregator run.
 */

const nodes: GraphNode[] = [];
const edges: GraphEdge[] = [];

function svc(id: string, name: string, layer: Layer, extra: Partial<ServiceNode> = {}): ServiceNode {
  const n: ServiceNode = {
    id,
    kind: 'service',
    name,
    layer,
    owner: extra.owner,
    repo: extra.repo ?? `https://github.com/acme/${id}`,
    language: extra.language,
    frameworks: extra.frameworks,
    description: extra.description,
    tags: extra.tags,
    inferred: extra.inferred,
    stats: { endpoints: 0, consumers: 0, calls: 0, publishes: 0 },
  };
  nodes.push(n);
  return n;
}

function ep(service: string, method: EndpointNode['method'], path: string, handler: string, file: string, line: number, summary?: string): EndpointNode {
  const n: EndpointNode = { id: `${service}#${method} ${path}`, kind: 'endpoint', service, method, path, handler, summary, location: { file, line } };
  nodes.push(n);
  const s = nodes.find((x) => x.kind === 'service' && x.id === service) as ServiceNode;
  s.stats.endpoints++;
  return n;
}

function handler(service: string, id: string, handlerKind: string, file: string, line: number, summary?: string): HandlerNode {
  const n: HandlerNode = { id: `${service}#${id}`, kind: 'handler', service, name: id, handlerKind, summary, location: { file, line } };
  nodes.push(n);
  return n;
}

function topic(broker: TopicNode['broker'], name: string): TopicNode {
  const n: TopicNode = { id: `topic:${broker}:${name}`, kind: 'topic', broker, name };
  nodes.push(n);
  return n;
}

function internal(service: string, from: string, to: string) {
  edges.push({ id: `int:${service}:${from}>${to}`, kind: 'internal', source: `${service}#${from}`, target: `${service}#${to}`, status: 'declared', confidence: 0.9 });
}

function http(source: string, target: string, fromHandler: string, method: EndpointNode['method'], url: string, endpoint: string | undefined, resolution: string, confidence: number, file: string, line: number, status: GraphEdge['status'] = 'declared') {
  const id = `http:${source}:${fromHandler}>${target}:${endpoint ?? url}`;
  edges.push({ id, kind: 'http', source, target, fromHandler, endpoint, method, url, status, resolution, confidence, location: { file, line } });
  if (endpoint) {
    edges.push({ id: `detail:${id}`, kind: 'http-detail', source: `${source}#${fromHandler}`, target: `${target}#${endpoint}`, fromHandler, endpoint, method, url, status, resolution, confidence, location: { file, line } });
  }
  const s = nodes.find((x) => x.kind === 'service' && x.id === source) as ServiceNode;
  s.stats.calls++;
}

function publish(source: string, topicId: string, fromHandler: string, file: string, line: number, routingKey?: string) {
  edges.push({ id: `pub:${source}:${fromHandler}>${topicId}`, kind: 'publish', source, target: topicId, fromHandler, routingKey, status: 'declared', confidence: 0.95, resolution: 'literal', location: { file, line } });
  const s = nodes.find((x) => x.kind === 'service' && x.id === source) as ServiceNode;
  s.stats.publishes++;
}

function consume(topicId: string, target: string, handlerId: string, file: string, line: number, routingKey?: string) {
  edges.push({ id: `con:${topicId}>${target}:${handlerId}`, kind: 'consume', source: topicId, target, fromHandler: handlerId, routingKey, status: 'declared', confidence: 0.95, resolution: 'literal', location: { file, line } });
  const s = nodes.find((x) => x.kind === 'service' && x.id === target) as ServiceNode;
  s.stats.consumers++;
}

// ---- services -------------------------------------------------------------
svc('web-ui', 'Web UI', 'ui', { owner: 'team-storefront', language: 'typescript', frameworks: ['react', 'vite'], description: 'Customer-facing storefront.' , tags: ['storefront'] });
svc('orders-experience-api', 'Orders Experience API', 'experience', { owner: 'team-orders', language: 'typescript', frameworks: ['nestjs'], description: 'BFF for order placement and tracking.', tags: ['orders'] });
svc('catalog-experience-api', 'Catalog Experience API', 'experience', { owner: 'team-storefront', language: 'typescript', frameworks: ['express'], description: 'BFF for browsing the product catalog.', tags: ['catalog'] });
svc('orders-capability-api', 'Orders Capability API', 'capability', { owner: 'team-orders', language: 'csharp', frameworks: ['aspnetcore'], description: 'Order lifecycle orchestration.', tags: ['orders'] });
svc('inventory-domain-api', 'Inventory Domain API', 'domain', { owner: 'team-supply', language: 'java', frameworks: ['spring'], description: 'Stock levels and reservations.' });
svc('payments-domain-api', 'Payments Domain API', 'domain', { owner: 'team-payments', language: 'java', frameworks: ['spring'], description: 'Authorisation and capture.' });
svc('customers-domain-api', 'Customers Domain API', 'domain', { owner: 'team-crm', language: 'csharp', frameworks: ['aspnetcore'], description: 'Customer profiles.' });
svc('products-domain-api', 'Products Domain API', 'domain', { owner: 'team-storefront', language: 'javascript', frameworks: ['express'], description: 'Product master data.' });
svc('notification-processor', 'Notification Processor', 'processor', { owner: 'team-crm', language: 'csharp', frameworks: ['aspnetcore'], description: 'Sends order and payment emails.' });
svc('analytics-worker', 'Analytics Worker', 'processor', { owner: 'team-data', language: 'typescript', frameworks: ['kafkajs'], description: 'Order metrics aggregation.' });
svc('api.stripe.com', 'Stripe', 'external', { inferred: true, repo: undefined, description: 'Payment provider (inferred from outbound call).' });
svc('api.sendgrid.com', 'SendGrid', 'external', { inferred: true, repo: undefined });
svc('api.wms-vendor.com', 'Warehouse (WMS)', 'external', { inferred: true, repo: undefined });

// ---- topics ---------------------------------------------------------------
const tOrderCreated = topic('kafka', 'order.created');
const tOrderCancelled = topic('kafka', 'order.cancelled');
const tPayments = topic('rabbitmq', 'payments');
const tMetrics = topic('kafka', 'analytics.order-metrics');

// ---- web-ui ---------------------------------------------------------------
handler('web-ui', 'CheckoutPage.submit', 'client', 'src/pages/CheckoutPage.tsx', 42, 'Submits the basket as an order.');
handler('web-ui', 'OrderStatusPage.load', 'client', 'src/pages/OrderStatusPage.tsx', 18);
handler('web-ui', 'ProductListPage.load', 'client', 'src/pages/ProductListPage.tsx', 15);
http('web-ui', 'orders-experience-api', 'CheckoutPage.submit', 'POST', '{VITE_ORDERS_EXP_URL}/v1/orders', 'POST /v1/orders', 'config', 0.9, 'src/pages/CheckoutPage.tsx', 48);
http('web-ui', 'orders-experience-api', 'OrderStatusPage.load', 'GET', '{VITE_ORDERS_EXP_URL}/v1/orders/{id}/status', 'GET /v1/orders/{id}/status', 'config', 0.9, 'src/pages/OrderStatusPage.tsx', 22);
http('web-ui', 'catalog-experience-api', 'ProductListPage.load', 'GET', '/v1/catalog/products', 'GET /v1/catalog/products', 'path-match', 0.7, 'src/pages/ProductListPage.tsx', 19);

// ---- orders-experience-api ------------------------------------------------
ep('orders-experience-api', 'POST', '/v1/orders', 'OrdersController.create', 'src/orders/orders.controller.ts', 21, 'Place an order');
ep('orders-experience-api', 'GET', '/v1/orders/{id}', 'OrdersController.get', 'src/orders/orders.controller.ts', 30);
ep('orders-experience-api', 'GET', '/v1/orders/{id}/status', 'OrdersController.status', 'src/orders/orders.controller.ts', 36);
handler('orders-experience-api', 'OrdersController.create', 'http', 'src/orders/orders.controller.ts', 21);
handler('orders-experience-api', 'OrdersController.get', 'http', 'src/orders/orders.controller.ts', 30);
handler('orders-experience-api', 'OrdersController.status', 'http', 'src/orders/orders.controller.ts', 36);
handler('orders-experience-api', 'OrdersService.place', 'service', 'src/orders/orders.service.ts', 14, 'Validates the customer then forwards the order to the capability API.');
handler('orders-experience-api', 'OrdersService.get', 'service', 'src/orders/orders.service.ts', 31);
handler('orders-experience-api', 'CustomersClient.get', 'client', 'src/clients/customers.client.ts', 9);
internal('orders-experience-api', 'OrdersController.create', 'OrdersService.place');
internal('orders-experience-api', 'OrdersController.get', 'OrdersService.get');
internal('orders-experience-api', 'OrdersController.status', 'OrdersService.get');
internal('orders-experience-api', 'OrdersService.place', 'CustomersClient.get');
http('orders-experience-api', 'customers-domain-api', 'CustomersClient.get', 'GET', '{CUSTOMERS_URL}/customers/{id}', 'GET /customers/{id}', 'config', 0.9, 'src/clients/customers.client.ts', 12);
http('orders-experience-api', 'orders-capability-api', 'OrdersService.place', 'POST', '{ORDERS_CAP_URL}/api/orders', 'POST /api/orders', 'config', 0.9, 'src/orders/orders.service.ts', 22);
http('orders-experience-api', 'orders-capability-api', 'OrdersService.get', 'GET', '{ORDERS_CAP_URL}/api/orders/{id}', 'GET /api/orders/{id}', 'config', 0.9, 'src/orders/orders.service.ts', 33);

// ---- catalog-experience-api ----------------------------------------------
ep('catalog-experience-api', 'GET', '/v1/catalog/products', 'routes.listProducts', 'src/routes.ts', 8);
ep('catalog-experience-api', 'GET', '/v1/catalog/products/{id}', 'routes.getProduct', 'src/routes.ts', 15);
handler('catalog-experience-api', 'routes.listProducts', 'http', 'src/routes.ts', 8);
handler('catalog-experience-api', 'routes.getProduct', 'http', 'src/routes.ts', 15);
http('catalog-experience-api', 'products-domain-api', 'routes.listProducts', 'GET', '{PRODUCTS_URL}/products', 'GET /products', 'config', 0.9, 'src/routes.ts', 10);
http('catalog-experience-api', 'products-domain-api', 'routes.getProduct', 'GET', '{PRODUCTS_URL}/products/{id}', 'GET /products/{id}', 'config', 0.9, 'src/routes.ts', 17);

// ---- orders-capability-api ------------------------------------------------
ep('orders-capability-api', 'POST', '/api/orders', 'OrdersController.Create', 'Controllers/OrdersController.cs', 24, 'Create an order');
ep('orders-capability-api', 'GET', '/api/orders/{id}', 'OrdersController.Get', 'Controllers/OrdersController.cs', 38);
ep('orders-capability-api', 'POST', '/api/orders/{id}/cancel', 'OrdersController.Cancel', 'Controllers/OrdersController.cs', 45);
ep('orders-capability-api', 'GET', '/health', 'Program.MapGet:/health', 'Program.cs', 31);
handler('orders-capability-api', 'OrdersController.Create', 'http', 'Controllers/OrdersController.cs', 24);
handler('orders-capability-api', 'OrdersController.Get', 'http', 'Controllers/OrdersController.cs', 38);
handler('orders-capability-api', 'OrdersController.Cancel', 'http', 'Controllers/OrdersController.cs', 45);
handler('orders-capability-api', 'Program.MapGet:/health', 'http', 'Program.cs', 31);
handler('orders-capability-api', 'OrderService.Place', 'service', 'Services/OrderService.cs', 28, 'Reserves inventory, authorises payment, persists and publishes order.created.');
handler('orders-capability-api', 'OrderService.Cancel', 'service', 'Services/OrderService.cs', 61);
handler('orders-capability-api', 'InventoryClient.Reserve', 'client', 'Clients/InventoryClient.cs', 14);
handler('orders-capability-api', 'PaymentsClient.Authorize', 'client', 'Clients/PaymentsClient.cs', 16);
handler('orders-capability-api', 'OrderEvents.Publish', 'service', 'Messaging/OrderEvents.cs', 20);
internal('orders-capability-api', 'OrdersController.Create', 'OrderService.Place');
internal('orders-capability-api', 'OrdersController.Cancel', 'OrderService.Cancel');
internal('orders-capability-api', 'OrderService.Place', 'InventoryClient.Reserve');
internal('orders-capability-api', 'OrderService.Place', 'PaymentsClient.Authorize');
internal('orders-capability-api', 'OrderService.Place', 'OrderEvents.Publish');
internal('orders-capability-api', 'OrderService.Cancel', 'OrderEvents.Publish');
http('orders-capability-api', 'inventory-domain-api', 'InventoryClient.Reserve', 'POST', '/inventory/reserve', 'POST /inventory/reserve', 'named-client', 0.85, 'Clients/InventoryClient.cs', 18);
http('orders-capability-api', 'payments-domain-api', 'PaymentsClient.Authorize', 'POST', '/payments/authorize', 'POST /payments/authorize', 'typed-client', 0.85, 'Clients/PaymentsClient.cs', 20);
publish('orders-capability-api', tOrderCreated.id, 'OrderService.Place', 'Services/OrderService.cs', 52);
publish('orders-capability-api', tOrderCancelled.id, 'OrderService.Cancel', 'Services/OrderService.cs', 70);

// ---- inventory-domain-api -------------------------------------------------
ep('inventory-domain-api', 'GET', '/inventory/{sku}', 'InventoryController.get', 'src/main/java/com/acme/inventory/InventoryController.java', 22);
ep('inventory-domain-api', 'POST', '/inventory/reserve', 'InventoryController.reserve', 'src/main/java/com/acme/inventory/InventoryController.java', 29, 'Reserve stock for an order');
ep('inventory-domain-api', 'POST', '/inventory/release', 'InventoryController.release', 'src/main/java/com/acme/inventory/InventoryController.java', 36);
handler('inventory-domain-api', 'InventoryController.get', 'http', 'src/main/java/com/acme/inventory/InventoryController.java', 22);
handler('inventory-domain-api', 'InventoryController.reserve', 'http', 'src/main/java/com/acme/inventory/InventoryController.java', 29);
handler('inventory-domain-api', 'InventoryController.release', 'http', 'src/main/java/com/acme/inventory/InventoryController.java', 36);
handler('inventory-domain-api', 'InventoryService.reserve', 'service', 'src/main/java/com/acme/inventory/InventoryService.java', 18);
handler('inventory-domain-api', 'InventoryService.release', 'service', 'src/main/java/com/acme/inventory/InventoryService.java', 40);
handler('inventory-domain-api', 'WmsClient.stock', 'client', 'src/main/java/com/acme/inventory/WmsClient.java', 15);
handler('inventory-domain-api', 'OrderCancelledListener.onMessage', 'message', 'src/main/java/com/acme/inventory/OrderCancelledListener.java', 14);
internal('inventory-domain-api', 'InventoryController.reserve', 'InventoryService.reserve');
internal('inventory-domain-api', 'InventoryController.release', 'InventoryService.release');
internal('inventory-domain-api', 'InventoryService.reserve', 'WmsClient.stock');
internal('inventory-domain-api', 'OrderCancelledListener.onMessage', 'InventoryService.release');
http('inventory-domain-api', 'api.wms-vendor.com', 'WmsClient.stock', 'GET', 'https://api.wms-vendor.com/v2/stock/{sku}', undefined, 'literal-host', 0.8, 'src/main/java/com/acme/inventory/WmsClient.java', 19);
consume(tOrderCancelled.id, 'inventory-domain-api', 'OrderCancelledListener.onMessage', 'src/main/java/com/acme/inventory/OrderCancelledListener.java', 14);

// ---- payments-domain-api --------------------------------------------------
ep('payments-domain-api', 'POST', '/payments/authorize', 'PaymentsController.authorize', 'src/main/java/com/acme/payments/PaymentsController.java', 20, 'Authorise a payment');
ep('payments-domain-api', 'POST', '/payments/capture', 'PaymentsController.capture', 'src/main/java/com/acme/payments/PaymentsController.java', 28);
handler('payments-domain-api', 'PaymentsController.authorize', 'http', 'src/main/java/com/acme/payments/PaymentsController.java', 20);
handler('payments-domain-api', 'PaymentsController.capture', 'http', 'src/main/java/com/acme/payments/PaymentsController.java', 28);
handler('payments-domain-api', 'PaymentService.authorize', 'service', 'src/main/java/com/acme/payments/PaymentService.java', 22);
handler('payments-domain-api', 'StripeClient.charge', 'client', 'src/main/java/com/acme/payments/StripeClient.java', 12);
internal('payments-domain-api', 'PaymentsController.authorize', 'PaymentService.authorize');
internal('payments-domain-api', 'PaymentService.authorize', 'StripeClient.charge');
http('payments-domain-api', 'api.stripe.com', 'StripeClient.charge', 'POST', 'https://api.stripe.com/v1/charges', undefined, 'literal-host', 0.8, 'src/main/java/com/acme/payments/StripeClient.java', 16);
publish('payments-domain-api', tPayments.id, 'PaymentService.authorize', 'src/main/java/com/acme/payments/PaymentService.java', 35, 'payment.authorized');

// ---- customers-domain-api -------------------------------------------------
ep('customers-domain-api', 'GET', '/customers/{id}', 'Program.MapGet:/customers/{id}', 'Program.cs', 18);
ep('customers-domain-api', 'PUT', '/customers/{id}', 'Program.MapPut:/customers/{id}', 'Program.cs', 24);
handler('customers-domain-api', 'Program.MapGet:/customers/{id}', 'http', 'Program.cs', 18);
handler('customers-domain-api', 'Program.MapPut:/customers/{id}', 'http', 'Program.cs', 24);

// ---- products-domain-api --------------------------------------------------
ep('products-domain-api', 'GET', '/products', 'app.get:/products', 'index.js', 9);
ep('products-domain-api', 'GET', '/products/{id}', 'app.get:/products/:id', 'index.js', 14);
handler('products-domain-api', 'app.get:/products', 'http', 'index.js', 9);
handler('products-domain-api', 'app.get:/products/:id', 'http', 'index.js', 14);

// ---- notification-processor ----------------------------------------------
handler('notification-processor', 'OrderCreatedConsumer.Handle', 'message', 'Consumers/OrderCreatedConsumer.cs', 22, 'Sends the order confirmation email.');
handler('notification-processor', 'PaymentAuthorizedConsumer.Handle', 'message', 'Consumers/PaymentAuthorizedConsumer.cs', 25);
handler('notification-processor', 'CustomersClient.GetEmail', 'client', 'Clients/CustomersClient.cs', 12);
handler('notification-processor', 'EmailSender.Send', 'client', 'Email/EmailSender.cs', 17);
internal('notification-processor', 'OrderCreatedConsumer.Handle', 'CustomersClient.GetEmail');
internal('notification-processor', 'OrderCreatedConsumer.Handle', 'EmailSender.Send');
internal('notification-processor', 'PaymentAuthorizedConsumer.Handle', 'EmailSender.Send');
consume(tOrderCreated.id, 'notification-processor', 'OrderCreatedConsumer.Handle', 'Consumers/OrderCreatedConsumer.cs', 22);
consume(tPayments.id, 'notification-processor', 'PaymentAuthorizedConsumer.Handle', 'Consumers/PaymentAuthorizedConsumer.cs', 25, 'payment.authorized');
http('notification-processor', 'customers-domain-api', 'CustomersClient.GetEmail', 'GET', '{Services:Customers:BaseUrl}/customers/{id}', 'GET /customers/{id}', 'config', 0.9, 'Clients/CustomersClient.cs', 15);
http('notification-processor', 'api.sendgrid.com', 'EmailSender.Send', 'POST', 'https://api.sendgrid.com/v3/mail/send', undefined, 'literal-host', 0.8, 'Email/EmailSender.cs', 21);

// ---- analytics-worker -----------------------------------------------------
handler('analytics-worker', 'consumer.eachMessage', 'message', 'src/index.ts', 20);
handler('analytics-worker', 'metrics.publish', 'service', 'src/metrics.ts', 9);
internal('analytics-worker', 'consumer.eachMessage', 'metrics.publish');
consume(tOrderCreated.id, 'analytics-worker', 'consumer.eachMessage', 'src/index.ts', 16);
consume(tOrderCancelled.id, 'analytics-worker', 'consumer.eachMessage', 'src/index.ts', 17);
publish('analytics-worker', tMetrics.id, 'metrics.publish', 'src/metrics.ts', 12);

// A trace-only edge the static extractor did not see.
edges.push({ id: 'http:observed:orders-experience-api>inventory-domain-api', kind: 'http', source: 'orders-experience-api', target: 'inventory-domain-api', method: 'GET', url: '/inventory/{sku}', endpoint: 'GET /inventory/{sku}', status: 'observed', resolution: 'trace', confidence: 0.6 });
// A low-confidence unresolved call.
edges.push({ id: 'http:unresolved:catalog-experience-api', kind: 'http', source: 'catalog-experience-api', target: 'orders-capability-api', fromHandler: 'routes.getProduct', method: 'GET', url: '{dynamicBase}/api/orders/{id}', status: 'declared', resolution: 'path-match', confidence: 0.4, location: { file: 'src/routes.ts', line: 24 } });
(nodes.find((n) => n.id === 'catalog-experience-api') as ServiceNode).stats.calls++;

// ---- flows ----------------------------------------------------------------
const flows: Flow[] = [
  {
    id: 'flow:place-order',
    name: 'Place order',
    useCase: 'Customer places an order',
    description: 'The storefront submits a basket. The experience API validates the customer, the capability API reserves stock and authorises payment, then publishes order.created which fans out to notifications and analytics.',
    entry: { service: 'web-ui', kind: 'handler', ref: 'CheckoutPage.submit' },
    steps: [
      { service: 'web-ui', ref: 'CheckoutPage.submit', kind: 'handler', description: 'Submit basket' },
      { service: 'orders-experience-api', ref: 'POST /v1/orders', kind: 'endpoint', description: 'Place order' },
      { service: 'customers-domain-api', ref: 'GET /customers/{id}', kind: 'endpoint', description: 'Validate customer' },
      { service: 'orders-capability-api', ref: 'POST /api/orders', kind: 'endpoint', description: 'Create order' },
      { service: 'inventory-domain-api', ref: 'POST /inventory/reserve', kind: 'endpoint', description: 'Reserve stock' },
      { service: 'api.wms-vendor.com', ref: 'GET https://api.wms-vendor.com/v2/stock/{sku}', kind: 'external', description: 'Check warehouse stock' },
      { service: 'payments-domain-api', ref: 'POST /payments/authorize', kind: 'endpoint', description: 'Authorise payment' },
      { service: 'api.stripe.com', ref: 'POST https://api.stripe.com/v1/charges', kind: 'external', description: 'Charge card' },
      { service: 'payments-domain-api', ref: tPayments.id, kind: 'publish', description: 'payment.authorized' },
      { service: 'orders-capability-api', ref: tOrderCreated.id, kind: 'publish', description: 'order.created' },
      { service: 'notification-processor', ref: 'OrderCreatedConsumer.Handle', kind: 'consumer', description: 'Send confirmation email' },
      { service: 'customers-domain-api', ref: 'GET /customers/{id}', kind: 'endpoint', description: 'Look up email' },
      { service: 'api.sendgrid.com', ref: 'POST https://api.sendgrid.com/v3/mail/send', kind: 'external', description: 'Send email' },
      { service: 'analytics-worker', ref: 'consumer.eachMessage', kind: 'consumer', description: 'Record metrics' },
      { service: 'analytics-worker', ref: tMetrics.id, kind: 'publish', description: 'analytics.order-metrics' },
    ],
  },
  {
    id: 'flow:cancel-order',
    name: 'Cancel order',
    useCase: 'Customer cancels an order',
    entry: { service: 'orders-capability-api', kind: 'endpoint', ref: 'POST /api/orders/{id}/cancel' },
    steps: [
      { service: 'orders-capability-api', ref: 'POST /api/orders/{id}/cancel', kind: 'endpoint', description: 'Cancel order' },
      { service: 'orders-capability-api', ref: tOrderCancelled.id, kind: 'publish', description: 'order.cancelled' },
      { service: 'inventory-domain-api', ref: 'OrderCancelledListener.onMessage', kind: 'consumer', description: 'Release reserved stock' },
      { service: 'analytics-worker', ref: 'consumer.eachMessage', kind: 'consumer', description: 'Record cancellation' },
    ],
  },
  {
    id: 'flow:browse-catalog',
    name: 'Browse catalog',
    useCase: 'Customer browses products',
    entry: { service: 'web-ui', kind: 'handler', ref: 'ProductListPage.load' },
    steps: [
      { service: 'web-ui', ref: 'ProductListPage.load', kind: 'handler', description: 'Open product list' },
      { service: 'catalog-experience-api', ref: 'GET /v1/catalog/products', kind: 'endpoint', description: 'List products' },
      { service: 'products-domain-api', ref: 'GET /products', kind: 'endpoint', description: 'Read product master data' },
    ],
  },
  {
    id: 'flow:order-status',
    name: 'Check order status',
    entry: { service: 'orders-experience-api', kind: 'endpoint', ref: 'GET /v1/orders/{id}/status' },
    steps: [
      { service: 'orders-experience-api', ref: 'GET /v1/orders/{id}/status', kind: 'endpoint' },
      { service: 'orders-capability-api', ref: 'GET /api/orders/{id}', kind: 'endpoint', description: 'Fetch order' },
    ],
  },
];

export const sampleGraph: Graph = {
  schemaVersion: '1',
  generatedAt: '2026-10-03T12:00:00Z',
  nodes,
  edges,
  flows,
  issues: [
    { level: 'warn', code: 'UNRESOLVED_TARGET', service: 'catalog-experience-api', message: 'Outbound call to {dynamicBase}/api/orders/{id} matched by path only (confidence 0.4).', location: { file: 'src/routes.ts', line: 24 } },
    { level: 'info', code: 'TRACE_ONLY_EDGE', service: 'orders-experience-api', message: 'Traces show calls to inventory-domain-api that static analysis did not find.' },
    { level: 'warn', code: 'DYNAMIC_TOPIC', service: 'analytics-worker', message: 'Topic list built from process.env.TOPICS could not be resolved statically.', location: { file: 'src/index.ts', line: 14 } },
    { level: 'error', code: 'PARSE_ERROR', service: 'products-domain-api', message: 'legacy/old-routes.js could not be parsed.', location: { file: 'legacy/old-routes.js', line: 1 } },
  ],
  services: nodes.filter((n): n is ServiceNode => n.kind === 'service').map((n) => n.id),
};
