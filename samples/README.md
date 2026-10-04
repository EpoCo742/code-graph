# Sample estate

Ten small, non-buildable applications that exercise every extractor plugin. They only need to parse.

| Service | Layer | Stack | Exposes | Calls / publishes |
| --- | --- | --- | --- | --- |
| web-ui | ui | React + TS, axios, fetch | - | orders-experience-api, catalog-experience-api |
| orders-experience-api | experience | NestJS | `POST /v1/orders`, `GET /v1/orders/{id}`, `GET /v1/orders/{id}/status` | orders-capability-api, customers-domain-api |
| catalog-experience-api | experience | Express (TS) | `GET /v1/catalog/products`, `GET /v1/catalog/products/{id}`, `GET /healthz` | products-domain-api |
| orders-capability-api | capability | ASP.NET Core + Confluent.Kafka | `POST /api/Orders`, `GET /api/Orders/{id}`, `POST /api/Orders/{id}/cancel`, `GET /health` | inventory-domain-api (named client), payments-domain-api (typed client); Kafka `order.created`, `order.cancelled` |
| inventory-domain-api | domain | Spring Boot + spring-kafka | `GET /inventory/{sku}`, `POST /inventory/reserve`, `POST /inventory/release`; consumes Kafka `order.cancelled` | external `api.wms-vendor.com` (RestTemplate) |
| payments-domain-api | domain | Spring Boot + Feign + spring-amqp | `POST /payments/authorize`, `POST /payments/capture` | external `api.stripe.com` (Feign); RabbitMQ exchange `payments` keys `payment.authorized`, `payment.captured` |
| customers-domain-api | domain | ASP.NET Core minimal APIs | `GET /customers/{id}`, `PUT /customers/{id}`, `GET /health` | - |
| products-domain-api | domain | Express (JS) | `GET /products`, `GET /products/{id}` | - |
| notification-processor | processor | .NET worker, Confluent.Kafka, RabbitMQ.Client | consumes Kafka `order.created`; RabbitMQ queue `notifications.payment` bound to `payments` / `payment.authorized` | customers-domain-api (typed client), external `api.sendgrid.com` |
| analytics-worker | processor | kafkajs | consumes Kafka `order.created`, `order.cancelled` | publishes Kafka `analytics.order-metrics` |

## Intended flows

**Place order**
web-ui `placeOrder` -> orders-experience-api `POST /v1/orders` -> customers-domain-api `GET /customers/{id}` and orders-capability-api `POST /api/Orders` -> inventory-domain-api `POST /inventory/reserve` and payments-domain-api `POST /payments/authorize` -> stripe; payments publishes RabbitMQ `payments` / `payment.authorized` -> notification-processor -> customers-domain-api + sendgrid. orders-capability-api publishes Kafka `order.created` -> notification-processor (email) and analytics-worker (publishes `analytics.order-metrics`).

**Cancel order**
orders-capability-api `POST /api/Orders/{id}/cancel` -> inventory-domain-api `POST /inventory/release`; publishes Kafka `order.cancelled` -> inventory-domain-api listener (release stock) and analytics-worker.

**Browse catalog**
web-ui `listProducts` -> catalog-experience-api `GET /v1/catalog/products` -> products-domain-api `GET /products`.

**Order status**
web-ui `getOrderStatus` -> orders-experience-api `GET /v1/orders/{id}/status` -> orders-capability-api `GET /api/Orders/{id}`.

Each app has a `codegraph.yaml` declaring its service id, layer, owner and a `targets` map from config keys / hosts to service ids.
