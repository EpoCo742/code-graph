/**
 * Aggregated graph: the output of merging all service manifests. This is the
 * single file the UI loads.
 */
import type { Broker, Flow, HttpMethod, Layer, SourceLocation } from './manifest.js';

export const GRAPH_SCHEMA_VERSION = '1' as const;

export type NodeKind = 'service' | 'endpoint' | 'topic' | 'handler' | 'external';

export interface ServiceNode {
  id: string;
  kind: 'service';
  name: string;
  layer: Layer;
  owner?: string;
  repo?: string;
  language?: string;
  frameworks?: string[];
  description?: string;
  tags?: string[];
  /** True when the node was synthesised from an unresolved outbound call (not from a manifest). */
  inferred?: boolean;
  stats: { endpoints: number; consumers: number; calls: number; publishes: number };
}

export interface EndpointNode {
  /** "<service>#<endpointId>" */
  id: string;
  kind: 'endpoint';
  service: string;
  method: HttpMethod;
  path: string;
  handler: string;
  summary?: string;
  location: SourceLocation;
}

export interface TopicNode {
  /** "topic:<broker>:<name>" */
  id: string;
  kind: 'topic';
  broker: Broker;
  name: string;
}

export interface HandlerNode {
  /** "<service>#<handlerId>" */
  id: string;
  kind: 'handler';
  service: string;
  name: string;
  handlerKind: string;
  summary?: string;
  location: SourceLocation;
}

export type GraphNode = ServiceNode | EndpointNode | TopicNode | HandlerNode;

export type EdgeKind =
  /** service -> service, derived from an HTTP call resolved to a provider */
  | 'http'
  /** service -> topic */
  | 'publish'
  /** topic -> service */
  | 'consume'
  /** handler -> handler within one service */
  | 'internal'
  /** handler -> endpoint (resolved outbound call at handler granularity) */
  | 'http-detail'
  /** service -> service declared in config, not seen in code */
  | 'declared';

export type EdgeStatus = 'declared' | 'observed' | 'both';

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  /** Where the edge originates in code, when known. */
  fromHandler?: string;
  /** For http edges: the specific endpoint id called, when resolved. */
  endpoint?: string;
  /** For messaging edges: routing key / group. */
  routingKey?: string;
  method?: HttpMethod;
  url?: string;
  status: EdgeStatus;
  /** How the target was resolved: config, hint, path-match, literal-host, trace, unresolved. */
  resolution?: string;
  confidence: number;
  location?: SourceLocation;
}

export interface GraphIssue {
  level: 'info' | 'warn' | 'error';
  code: string;
  service?: string;
  message: string;
  location?: SourceLocation;
}

export interface Graph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  flows: Flow[];
  issues: GraphIssue[];
  /** Service ids in manifest order, for stable layout. */
  services: string[];
}
