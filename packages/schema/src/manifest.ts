/**
 * Service manifest: the per-repository artifact produced by the extractor.
 *
 * One manifest per deployable service. It is intentionally small: an inventory
 * of what the service exposes (HTTP endpoints, message consumers), what it
 * calls (outbound HTTP, message publishes), and the code units ("handlers")
 * that connect them. Edge targets are NOT resolved here; the aggregator does
 * that across all manifests.
 */

export const MANIFEST_SCHEMA_VERSION = '1' as const;

export type Layer =
  | 'ui'
  | 'experience'
  | 'capability'
  | 'domain'
  | 'processor'
  | 'external'
  | 'unknown';

export const LAYERS: Layer[] = ['ui', 'experience', 'capability', 'domain', 'processor', 'external', 'unknown'];

export type Broker = 'kafka' | 'rabbitmq' | 'sqs' | 'sns' | 'servicebus' | 'pubsub' | 'unknown';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY';

export interface SourceLocation {
  /** Path relative to the repository root, forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
}

export interface ServiceInfo {
  /** Stable identifier (kebab-case). Used as graph node id and for edge resolution. */
  id: string;
  /** Human readable name. */
  name: string;
  layer: Layer;
  owner?: string;
  /** Repository URL or path. */
  repo?: string;
  /** Primary language, e.g. csharp, java, typescript. */
  language?: string;
  /** Frameworks detected or declared, e.g. aspnetcore, spring, express, nestjs, react. */
  frameworks?: string[];
  description?: string;
  /** Free-form tags, e.g. team names, domains. */
  tags?: string[];
}

export type HandlerKind = 'http' | 'message' | 'service' | 'client' | 'other';

/**
 * A code unit: typically a method. Handlers form the intra-service call graph
 * which lets the aggregator trace an inbound endpoint to the outbound calls it
 * eventually makes.
 */
export interface Handler {
  /** Unique within the manifest. Convention: "<Type>.<method>" or "<file>:<name>". */
  id: string;
  kind: HandlerKind;
  /** Display name, usually "<Type>.<method>". */
  name: string;
  location: SourceLocation;
  /** Ids of other handlers this one calls directly (best-effort static resolution). */
  calls: string[];
  /** Short natural-language description; populated by enrichment, never required. */
  summary?: string;
  /** Content hash of the handler body, used by enrichment caching. */
  hash?: string;
}

export interface HttpEndpoint {
  /** Unique within the manifest, e.g. "GET /api/orders/{id}". */
  id: string;
  method: HttpMethod;
  /** Normalised path: leading slash, path params as {name}. */
  path: string;
  /** Handler id that implements this endpoint. */
  handler: string;
  location: SourceLocation;
  operationId?: string;
  summary?: string;
}

export interface MessageConsumer {
  id: string;
  broker: Broker;
  /** Kafka topic, RabbitMQ queue, SQS queue name, etc. */
  topic: string;
  /** For RabbitMQ: the exchange the queue is bound to, if determinable. */
  exchange?: string;
  /** For RabbitMQ: binding routing key; for Kafka: consumer group id. */
  routingKey?: string;
  group?: string;
  handler: string;
  location: SourceLocation;
}

export interface HttpCall {
  id: string;
  method?: HttpMethod;
  /**
   * The URL or path as written in code, with interpolations replaced by {expr}.
   * Example: "{baseUrl}/orders/{id}" or "https://api.stripe.com/v1/charges".
   */
  url: string;
  /**
   * A hint for resolving the target service: a config key (e.g. "Services:Orders:BaseUrl"),
   * a named HttpClient ("orders"), a Feign client name, an env var, or a literal host.
   */
  targetHint?: string;
  /** Explicitly declared target service id (from code annotations or extractor config). */
  targetService?: string;
  fromHandler: string;
  location: SourceLocation;
}

export interface MessagePublish {
  id: string;
  broker: Broker;
  /** Kafka topic, RabbitMQ exchange (or queue when sendToQueue), SQS queue. */
  topic: string;
  routingKey?: string;
  fromHandler: string;
  location: SourceLocation;
}

export interface FlowStep {
  /** Service id this step runs in. */
  service: string;
  /** Endpoint id, consumer id or handler id in that service. */
  ref: string;
  kind: 'endpoint' | 'consumer' | 'handler' | 'call' | 'publish' | 'external';
  /** Service id (or topic id for consumer steps) that triggered this step. Absent on the entry step. */
  from?: string;
  description?: string;
}

/**
 * A use case / scenario: an entry point and the ordered steps it triggers.
 * Produced by the aggregator (structurally) and enriched with names by AI.
 */
export interface Flow {
  id: string;
  name: string;
  /** Business-facing use case label, e.g. "Place order". */
  useCase?: string;
  description?: string;
  /** Entry kind 'handler' is used for UI-layer code units that initiate calls but expose no endpoint. */
  entry: { service: string; kind: 'endpoint' | 'consumer' | 'handler'; ref: string };
  steps: FlowStep[];
}

export interface ExtractionIssue {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  location?: SourceLocation;
}

export interface ServiceManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  service: ServiceInfo;
  generatedAt: string;
  commit?: string;
  /** Tool and version that produced the manifest. */
  generator?: { name: string; version: string };
  endpoints: HttpEndpoint[];
  consumers: MessageConsumer[];
  calls: HttpCall[];
  publishes: MessagePublish[];
  handlers: Handler[];
  /** Optional declared dependencies that static analysis cannot see (e.g. from config). */
  declaredDependencies?: { service: string; reason?: string }[];
  issues?: ExtractionIssue[];
}

/**
 * Per-repository extractor configuration, read from `codegraph.yaml` (or .json)
 * at the repo root. Everything is optional; the extractor infers what it can.
 */
export interface ExtractorConfig {
  service?: Partial<ServiceInfo>;
  /** Globs (relative to repo root) to include/exclude. */
  include?: string[];
  exclude?: string[];
  /** Map of config keys / named clients / hosts to target service ids. */
  targets?: Record<string, string>;
  /** Explicit dependencies not visible in code. */
  declaredDependencies?: { service: string; reason?: string }[];
  /** Force-enable or disable framework plugins by name. */
  plugins?: { enable?: string[]; disable?: string[] };
}
