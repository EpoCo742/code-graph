# @codegraph/extractor

Static extractor that turns one repository into a `ServiceManifest` (see `@codegraph/schema`): the HTTP endpoints and message consumers the service exposes, the outbound HTTP calls and message publishes it makes, and the intra-service call graph that links the two. It parses source with tree-sitter (WASM, no native build) and runs a set of framework plugins over the parsed facts. Nothing is executed and no dependencies of the analysed repo are installed.

Supported languages: C#, Java, TypeScript (including TSX) and JavaScript.

## Usage

```
npm run build                      # from the monorepo root
node packages/extractor/dist/cli.js <repoPath> --out manifest.json [--verbose]
```

Or, once published to GitHub Packages, `npx @codegraph/extractor <repoPath>` (the package has a single bin, `codegraph-extract`).

| Option | Meaning |
| --- | --- |
| `--out <file>` | Write the manifest to a file instead of stdout. |
| `--config <file>` | Use this config instead of `<repo>/codegraph.yaml`. |
| `--service-id <id>` | Override the service id. |
| `--layer <layer>` | Override the layer (`ui`, `experience`, `capability`, `domain`, `processor`, `external`, `unknown`). |
| `--no-prune` | Keep every code unit as a handler, not only the ones on an entry → effect path. |
| `--verbose` | Print selected plugins and counts to stderr. |

Exit code is non-zero when the manifest fails schema validation or a plugin reports an `error` issue.

Programmatic API:

```ts
import { extract } from '@codegraph/extractor';
const { manifest, plugins, stats } = await extract('/path/to/repo', { serviceId: 'orders-api' });
```

`npm run extract:samples` (root) extracts every directory under `samples/` that has a `codegraph.yaml` into `out/manifests/<service-id>.json`.

## Config file: `codegraph.yaml`

Optional. Place it at the repo root. Every field is optional; the extractor infers the rest.

```yaml
service:
  id: orders-capability-api        # kebab-case; default: package.json name / *.csproj name / pom artifactId, slugified
  name: Orders Capability API      # default: same source as id, unslugified
  layer: capability                # default: inferred from the id (-ui/-web → ui, -experience/-bff → experience,
                                   #          -capability → capability, -domain → domain, -processor/-worker/-consumer → processor)
  owner: team-orders
  repo: https://github.com/acme/orders-capability-api
  language: csharp                 # default: dominant parsed language
  frameworks: [aspnetcore, kafka]  # default: inferred from package.json / csproj / pom dependencies
  description: Owns the order lifecycle.
  tags: [orders, checkout]

include:                           # globs relative to the repo root; default: all supported source files
  - src/**
exclude:                           # added to the built-in excludes (node_modules, bin, obj, dist, build, target, tests, *.spec.*, ...)
  - "**/Migrations/**"

targets:                           # resolve outbound-call hints to service ids (exact, case-insensitive match)
  "Services:Inventory:BaseUrl": inventory-domain-api   # .NET configuration key
  ORDERS_CAP_URL: orders-capability-api               # env var / Vite variable
  wms.base-url: wms-vendor                            # Spring @Value key
  api.stripe.com: stripe                              # literal host
  inventory: inventory-domain-api                     # named HttpClient / Feign client name

declaredDependencies:              # edges that code cannot show (e.g. configured in infra)
  - service: audit-log-api
    reason: configured via sidecar

plugins:
  enable: [spring]                 # force a plugin on even if detection fails
  disable: [express]               # force a plugin off
```

`targetHint` is always recorded on a call even when it does not match `targets`; the aggregator applies its own global target map and path matching afterwards, so per-repo `targets` are a convenience, not a requirement.

## What is detected

Each plugin has `detect(repo)` (dependency names and code shapes) and `apply(ctx)`.

| Plugin | Endpoints / consumers | Outbound |
| --- | --- | --- |
| `aspnetcore` | `[HttpGet/Post/Put/Patch/Delete/Head/Options]` + `[Route]` on controllers with class-level `[Route]` prefix and `[controller]`/`[action]` substitution; minimal APIs `app.MapGet/MapPost/...` including `MapGroup` prefixes | – |
| `spring` | `@GetMapping/@PostMapping/...`, `@RequestMapping(method=...)` with class-level `@RequestMapping` prefix; JAX-RS `@GET` + `@Path` | Feign `@FeignClient(name, url)` interfaces with mapping annotations (hint = host of `url`, `${key}` or `name`) |
| `express` | `app|router.get/post/...('/path', handler)` for Express, Koa-router and Fastify, `fastify.route({...})`, with `app.use('/prefix', router)` and `register(plugin, { prefix })` mounts followed across files | – |
| `nestjs` | `@Controller('prefix')` + `@Get/@Post/...`, `setGlobalPrefix` | – |
| `http-clients` | – | .NET `HttpClient` (`GetAsync`, `PostAsJsonAsync`, `SendAsync` + `HttpRequestMessage`, ...), named clients (`CreateClient("x")`) and typed clients (`AddHttpClient<T>(...)`, hint = config key from the registration lambda), Refit interfaces; Java `RestTemplate`, `WebClient`/`RestClient` (`.get().uri(...)`); JS `fetch`, `axios` (static and `axios.create({ baseURL })` instances incl. class fields), Angular `HttpClient`, Nest `HttpService`, `got`/`ky` |
| `kafka` | Confluent `Subscribe(...)`, spring-kafka `@KafkaListener(topics, groupId)`, kafkajs `subscribe({ topic(s) })` (handler = `run({ eachMessage })` function), MassTransit `IConsumer<T>` | Confluent `ProduceAsync/Produce`, `kafkaTemplate.send`, kafkajs `producer.send({ topic })`, MassTransit `Publish<T>` |
| `rabbitmq` | RabbitMQ.Client `BasicConsume(queue:)` with `QueueBind` exchange/routing key, spring-amqp `@RabbitListener(queues)` and `bindings=@QueueBinding(...)`, amqplib `channel.consume(q)` with `bindQueue` | `BasicPublish(exchange, routingKey)`, `rabbitTemplate.convertAndSend(exchange, key, msg)` / `(key, msg)`, amqplib `publish(ex, key)` / `sendToQueue(q)` |

Topic, queue and route names given as constants are resolved through the repo's string constants (`Topics.OrderCreated`, `private const string Queue = ...`, `export const ORDER_CREATED = ...`). When a constant cannot be resolved the identifier text is used and an `unresolved-topic` issue is recorded.

Target hints are derived, in order, from: an absolute URL host; a config/env reference inside the URL expression (`config["A:B"]`, `process.env.X`, `import.meta.env.X`, `${key}`); a `@Value("${key}")` on the referenced field; an assignment to the referenced field elsewhere in the type; a module-level variable initialised from such an expression; a named/typed client registration; the client type name.

### Handlers and the call graph

Every method, function, constructor, module scope and anonymous function is a code unit. `Handler.calls` is a best-effort static resolution of `receiver.method(...)`:

- receiver is a constructor-injected parameter, field or parameter property → its declared type; interfaces resolve to implementing classes (or `IFoo` → `Foo`);
- bare calls and `this.x()` → same type, then same file, then an imported function of that name;
- lambdas and callbacks are their own units, linked from the enclosing unit, so a RabbitMQ `Received += (...) => Handle(...)` or an Express inline handler still reaches its outbound calls.

By default the manifest keeps only units that are an entry (endpoint/consumer handler), have an effect (call/publish), or lie on a path between the two. `--no-prune` keeps everything.

`Handler.hash` is the first 16 hex characters of the SHA-256 of the whitespace-normalised body, for enrichment caching.

## Adding a plugin

1. Create `src/plugins/<name>.ts` exporting a `Plugin` (`name`, `detect(repo)`, `apply(ctx)`).
2. Iterate `ctx.repo.units` (code units with `attrs`, `invocations`, `strings`, `params`) and `ctx.repo.types` (classes with `attrs`, `fields`, `ctorParams`, `baseTypes`, `methods`, `constants`).
3. Emit with `ctx.addEndpoint`, `ctx.addConsumer`, `ctx.addCall`, `ctx.addPublish`; use `ctx.resolveString` for constant references, `ctx.hintFor` for URL arguments and `ctx.targetFor` to map a hint via config. Report problems with `ctx.issue(...)`.
4. Register it in `src/plugins/index.ts`.

For a new language, add a frontend in `src/frontends/` that produces `FileFacts` (see `model.ts`); the shared expression/invocation extraction in `frontends/common.ts` is driven by a small `LangSpec` of tree-sitter node types.

## Known limitations

- Resolution is syntactic. Routes or topics built at runtime, reflection, generated clients and DI registrations the plugins do not know about are missed; an issue is recorded where the extractor notices.
- Call-graph resolution does not follow inheritance across files beyond direct base types, generics, delegates/events, or dynamic dispatch through collections. Multiple implementations of an interface all count as callees.
- Express mount resolution follows relative imports only; routers passed through factories or dependency injection are not prefixed.
- A unit that uses several named `HttpClient`s picks the first `CreateClient("...")` literal in that unit (or type) for calls whose URL carries no hint of its own.
- `SendAsync` URLs come from the first `new HttpRequestMessage(HttpMethod.X, "...")` in the same method.
- Python, Go and Kotlin are not parsed yet; the tree-sitter grammars exist and a frontend plus plugins would follow the same pattern.
