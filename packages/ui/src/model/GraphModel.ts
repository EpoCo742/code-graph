import type {
  EndpointNode,
  Flow,
  Graph,
  GraphEdge,
  GraphIssue,
  GraphNode,
  HandlerNode,
  Layer,
  ServiceNode,
  TopicNode,
} from '@codegraph/schema';

export const LAYER_ORDER: Layer[] = ['ui', 'experience', 'capability', 'domain', 'processor', 'external', 'unknown'];

export const LAYER_LABEL: Record<Layer, string> = {
  ui: 'UI',
  experience: 'Experience',
  capability: 'Capability',
  domain: 'Domain',
  processor: 'Processors',
  external: 'External',
  unknown: 'Unknown',
};

export function layerIndex(layer: Layer): number {
  const i = LAYER_ORDER.indexOf(layer);
  return i < 0 ? LAYER_ORDER.length - 1 : i;
}

/** Service-level edge kinds (the ones drawn on the service map). */
export const MAP_EDGE_KINDS = new Set(['http', 'publish', 'consume', 'declared']);

/** Strip a "<service>#" prefix from a handler reference if present. */
export function bareHandler(service: string, ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const prefix = service + '#';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

export function handlerNodeId(service: string, handler: string): string {
  return handler.includes('#') ? handler : `${service}#${handler}`;
}

/** Fully qualify a flow-step / entry ref ("GET /x" -> "<service>#GET /x"); ids that are already node or edge ids pass through. */
export function qualifyRef(service: string, ref: string): string {
  if (ref.includes('#') || /^(topic|consume|publish|http|external):/.test(ref)) return ref;
  return `${service}#${ref}`;
}

/** Human label for a ref: strips a "<service>#" prefix and consume/publish edge prefixes. */
export function refLabel(ref: string): string {
  const hash = ref.indexOf('#');
  if (hash >= 0) return ref.slice(hash + 1);
  const m = /^(consume|publish):[^:]+:([^:]+):(.+)$/.exec(ref);
  if (m) return `${m[2]} ${m[3]}`;
  return ref.replace(/^topic:[^:]+:/, '');
}

/** Endpoint label without the method, e.g. "orders-api#GET /orders/{id}" -> "/orders/{id}". */
export function endpointPath(ref: string): string {
  return refLabel(ref).replace(/^[A-Z]+ /, '');
}

export interface Neighbourhood {
  nodes: Set<string>;
  edges: Set<string>;
  /** Hop distance per node id (0 = origin). */
  depth: Map<string, number>;
}

export class GraphModel {
  readonly graph: Graph;
  readonly nodes = new Map<string, GraphNode>();
  readonly services: ServiceNode[] = [];
  readonly topics: TopicNode[] = [];
  readonly endpoints: EndpointNode[] = [];
  readonly handlers: HandlerNode[] = [];
  readonly edges = new Map<string, GraphEdge>();
  readonly outEdges = new Map<string, GraphEdge[]>();
  readonly inEdges = new Map<string, GraphEdge[]>();
  readonly endpointsByService = new Map<string, EndpointNode[]>();
  readonly handlersByService = new Map<string, HandlerNode[]>();
  readonly issuesByService = new Map<string, GraphIssue[]>();
  readonly flowsByEntry = new Map<string, Flow>();
  readonly owners: string[];

  constructor(graph: Graph) {
    this.graph = graph;
    for (const n of graph.nodes) {
      this.nodes.set(n.id, n);
      switch (n.kind) {
        case 'service':
          this.services.push(n);
          break;
        case 'topic':
          this.topics.push(n);
          break;
        case 'endpoint':
          this.endpoints.push(n);
          push(this.endpointsByService, n.service, n);
          break;
        case 'handler':
          this.handlers.push(n);
          push(this.handlersByService, n.service, n);
          break;
      }
    }
    for (const e of graph.edges) {
      this.edges.set(e.id, e);
      push(this.outEdges, e.source, e);
      push(this.inEdges, e.target, e);
    }
    for (const i of graph.issues) if (i.service) push(this.issuesByService, i.service, i);
    for (const f of graph.flows) this.flowsByEntry.set(qualifyRef(f.entry.service, f.entry.ref), f);
    this.owners = [...new Set(this.services.map((s) => s.owner).filter((o): o is string => !!o))].sort();
  }

  service(id: string): ServiceNode | undefined {
    const n = this.nodes.get(id);
    return n?.kind === 'service' ? n : undefined;
  }

  topic(id: string): TopicNode | undefined {
    const n = this.nodes.get(id);
    return n?.kind === 'topic' ? n : undefined;
  }

  endpoint(id: string): EndpointNode | undefined {
    const n = this.nodes.get(id);
    return n?.kind === 'endpoint' ? n : undefined;
  }

  out(id: string): GraphEdge[] {
    return this.outEdges.get(id) ?? [];
  }

  in(id: string): GraphEdge[] {
    return this.inEdges.get(id) ?? [];
  }

  /** Service-level edges (http/publish/consume/declared) only. */
  mapEdges(): GraphEdge[] {
    return this.graph.edges.filter((e) => MAP_EDGE_KINDS.has(e.kind));
  }

  flowForEndpoint(service: string, endpointId: string): Flow | undefined {
    return this.flowsByEntry.get(qualifyRef(service, endpointId));
  }

  /** Flow whose entry is this endpoint node id ("<service>#<endpoint>"). */
  flowForEndpointNode(id: string): Flow | undefined {
    return this.flowsByEntry.get(id);
  }

  /** http-detail edges from any handler of a service, optionally limited to one target service. */
  detailEdges(service: string, target?: string): GraphEdge[] {
    const out: GraphEdge[] = [];
    for (const h of this.handlersByService.get(service) ?? []) {
      for (const e of this.out(h.id)) {
        if (e.kind !== 'http-detail') continue;
        if (target && !e.target.startsWith(target + '#') && e.target !== target) continue;
        out.push(e);
      }
    }
    return out;
  }

  /** Service id an edge lands in (resolves endpoint / handler targets to their service). */
  targetService(e: GraphEdge): string {
    const n = this.nodes.get(e.target);
    if (n?.kind === 'endpoint' || n?.kind === 'handler') return n.service;
    const hash = e.target.indexOf('#');
    return hash >= 0 ? e.target.slice(0, hash) : e.target;
  }

  /** Flows in which a service participates. */
  flowsForService(service: string): Flow[] {
    return this.graph.flows.filter((f) => f.entry.service === service || f.steps.some((s) => s.service === service));
  }

  /**
   * Transitive closure of handlers reachable from a handler within one service,
   * following 'internal' edges. Returns bare handler ids (without service prefix).
   */
  reachableHandlers(service: string, handler: string): Set<string> {
    const start = handlerNodeId(service, handler);
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of this.out(cur)) {
        if (e.kind !== 'internal') continue;
        if (!seen.has(e.target)) {
          seen.add(e.target);
          stack.push(e.target);
        }
      }
    }
    return new Set([...seen].map((h) => bareHandler(service, h)!));
  }

  /** Outbound http/publish/http-detail edges that originate from any handler in the set. */
  outboundFromHandlers(service: string, handlers: Set<string>): GraphEdge[] {
    const out: GraphEdge[] = [];
    for (const e of this.out(service)) {
      if ((e.kind === 'http' || e.kind === 'publish' || e.kind === 'declared') && e.fromHandler) {
        if (handlers.has(bareHandler(service, e.fromHandler)!)) out.push(e);
      }
    }
    for (const h of handlers) {
      for (const e of this.out(handlerNodeId(service, h))) if (e.kind === 'http-detail') out.push(e);
    }
    return out;
  }

  /** Everything an endpoint transitively triggers inside and outside its service. */
  endpointImpact(ep: EndpointNode): { handlers: Set<string>; outbound: GraphEdge[] } {
    const handlers = this.reachableHandlers(ep.service, ep.handler);
    return { handlers, outbound: this.outboundFromHandlers(ep.service, handlers) };
  }

  /** Breadth-first neighbourhood over service-level edges. */
  neighbourhood(origin: string, upstream: number, downstream: number, allowed?: (e: GraphEdge) => boolean): Neighbourhood {
    const nodes = new Set<string>([origin]);
    const edges = new Set<string>();
    const depth = new Map<string, number>([[origin, 0]]);
    const walk = (dir: 'out' | 'in', hops: number) => {
      let frontier = [origin];
      for (let d = 1; d <= hops && frontier.length; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          const list = dir === 'out' ? this.out(id) : this.in(id);
          for (const e of list) {
            if (!MAP_EDGE_KINDS.has(e.kind)) continue;
            if (allowed && !allowed(e)) continue;
            const other = dir === 'out' ? e.target : e.source;
            edges.add(e.id);
            if (!nodes.has(other)) {
              nodes.add(other);
              depth.set(other, d);
              next.push(other);
            }
          }
        }
        frontier = next;
      }
    };
    walk('out', downstream);
    walk('in', upstream);
    return { nodes, edges, depth };
  }

  stats() {
    const mapEdges = this.mapEdges();
    return {
      services: this.services.length,
      endpoints: this.endpoints.length,
      topics: this.topics.length,
      edges: mapEdges.length,
      unresolved: mapEdges.filter((e) => e.resolution === 'unresolved' || e.confidence < 0.5).length,
      flows: this.graph.flows.length,
      issues: this.graph.issues.length,
    };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Best-effort link to a source file in a hosted repository. */
export function sourceLink(repo: string | undefined, file: string, line: number): string | undefined {
  if (!repo || !/^https?:\/\//.test(repo)) return undefined;
  const r = repo.replace(/\.git$/, '').replace(/\/$/, '');
  if (/github\.com|gitlab\.com/.test(r)) {
    const sep = /github\.com/.test(r) ? 'blob' : '-/blob';
    return `${r}/${sep}/HEAD/${file}#L${line}`;
  }
  if (/dev\.azure\.com|visualstudio\.com/.test(r)) {
    return `${r}?path=/${encodeURIComponent(file)}&line=${line}&lineEnd=${line + 1}&lineStartColumn=1&lineEndColumn=1`;
  }
  return r;
}
