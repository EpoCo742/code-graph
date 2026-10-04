import type {
  Broker,
  EndpointNode,
  Graph,
  GraphEdge,
  GraphIssue,
  GraphNode,
  HandlerNode,
  HttpCall,
  HttpEndpoint,
  ServiceManifest,
  ServiceNode,
  TopicNode,
} from '@codegraph/schema';
import type { AggregateConfig } from './config.js';
import { matchScore, parseCallUrl, pathMatches, tokens } from './paths.js';

export const endpointNodeId = (service: string, endpointId: string) => `${service}#${endpointId}`;
export const handlerNodeId = (service: string, handlerId: string) => `${service}#${handlerId}`;
export const topicNodeId = (broker: Broker, name: string) => `topic:${broker}:${name}`;
export const externalNodeId = (host: string) => `external:${host.toLowerCase()}`;

export interface BuildContext {
  manifests: ServiceManifest[];
  config: AggregateConfig;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  issues: GraphIssue[];
  /** service id -> endpoints */
  endpointsByService: Map<string, HttpEndpoint[]>;
}

interface Resolution {
  service: string;
  resolution: string;
  confidence: number;
  endpoint?: HttpEndpoint;
}

/** Build nodes and edges (everything except flows) from manifests. */
export function buildGraph(manifests: ServiceManifest[], config: AggregateConfig): BuildContext {
  const ignore = new Set(config.ignoreServices ?? []);
  manifests = manifests.filter((m) => !ignore.has(m.service.id));
  const ctx: BuildContext = {
    manifests,
    config,
    nodes: new Map(),
    edges: [],
    issues: [],
    endpointsByService: new Map(),
  };

  // 1. Service, endpoint, handler nodes + internal edges
  for (const m of manifests) {
    const s = m.service;
    const node: ServiceNode = {
      id: s.id,
      kind: 'service',
      name: s.name,
      layer: s.layer,
      owner: s.owner,
      repo: s.repo,
      language: s.language,
      frameworks: s.frameworks,
      description: s.description,
      tags: s.tags,
      stats: {
        endpoints: m.endpoints.length,
        consumers: m.consumers.length,
        calls: m.calls.length,
        publishes: m.publishes.length,
      },
    };
    ctx.nodes.set(s.id, node);
    ctx.endpointsByService.set(s.id, m.endpoints);
    for (const e of m.endpoints) {
      const en: EndpointNode = {
        id: endpointNodeId(s.id, e.id),
        kind: 'endpoint',
        service: s.id,
        method: e.method,
        path: e.path,
        handler: e.handler,
        summary: e.summary,
        location: e.location,
      };
      ctx.nodes.set(en.id, en);
    }
    for (const h of m.handlers) {
      const hn: HandlerNode = {
        id: handlerNodeId(s.id, h.id),
        kind: 'handler',
        service: s.id,
        name: h.name,
        handlerKind: h.kind,
        summary: h.summary,
        location: h.location,
      };
      ctx.nodes.set(hn.id, hn);
    }
    for (const h of m.handlers) {
      for (const callee of h.calls) {
        ctx.edges.push({
          id: `internal:${s.id}:${h.id}->${callee}`,
          kind: 'internal',
          source: handlerNodeId(s.id, h.id),
          target: handlerNodeId(s.id, callee),
          status: 'declared',
          resolution: 'static',
          confidence: 0.9,
          location: h.location,
        });
      }
    }
    for (const iss of m.issues ?? []) {
      ctx.issues.push({ level: iss.level, code: `extract:${iss.code}`, service: s.id, message: iss.message, location: iss.location });
    }
  }

  // 2. Messaging: topics, publish and consume edges
  for (const m of manifests) {
    const sid = m.service.id;
    for (const p of m.publishes) {
      const t = ensureTopic(ctx, p.broker, p.topic);
      ctx.edges.push({
        id: `publish:${sid}:${p.id}`,
        kind: 'publish',
        source: sid,
        target: t.id,
        fromHandler: handlerNodeId(sid, p.fromHandler),
        routingKey: p.routingKey,
        status: 'declared',
        resolution: 'static',
        confidence: 0.95,
        location: p.location,
      });
    }
    for (const c of m.consumers) {
      // RabbitMQ: a consumer bound to an exchange listens on that exchange's topic node.
      const name = c.broker === 'rabbitmq' && c.exchange ? c.exchange : c.topic;
      const t = ensureTopic(ctx, c.broker, name);
      ctx.edges.push({
        id: `consume:${sid}:${c.id}`,
        kind: 'consume',
        source: t.id,
        target: sid,
        fromHandler: handlerNodeId(sid, c.handler),
        routingKey: c.routingKey ?? c.group,
        status: 'declared',
        resolution: 'static',
        confidence: 0.95,
        location: c.location,
      });
    }
  }
  // Topics with no consumers or no publishers are worth flagging
  for (const n of ctx.nodes.values()) {
    if (n.kind !== 'topic') continue;
    const hasPub = ctx.edges.some((e) => e.kind === 'publish' && e.target === n.id);
    const hasSub = ctx.edges.some((e) => e.kind === 'consume' && e.source === n.id);
    if (!hasPub) ctx.issues.push({ level: 'info', code: 'topic:no-publisher', message: `No publisher found in the estate for ${n.broker} topic "${n.name}" (external producer?)` });
    if (!hasSub) ctx.issues.push({ level: 'info', code: 'topic:no-consumer', message: `No consumer found in the estate for ${n.broker} topic "${n.name}" (external consumer?)` });
  }

  // 3. HTTP calls → resolved edges
  const serviceEdgeIndex = new Map<string, GraphEdge>();
  for (const m of manifests) {
    const sid = m.service.id;
    for (const call of m.calls) {
      const r = resolveCall(ctx, sid, call);
      if (!r) {
        ctx.issues.push({
          level: 'warn',
          code: 'call:unresolved',
          service: sid,
          message: `Could not resolve target of ${call.method ?? 'HTTP'} ${call.url}${call.targetHint ? ` (hint: ${call.targetHint})` : ''} from ${call.fromHandler}`,
          location: call.location,
        });
        continue;
      }
      // service-level edge (one per source/target pair)
      const key = `${sid}->${r.service}`;
      let se = serviceEdgeIndex.get(key);
      if (!se) {
        se = {
          id: `http:${key}`,
          kind: 'http',
          source: sid,
          target: r.service,
          status: 'declared',
          resolution: r.resolution,
          confidence: r.confidence,
          location: call.location,
        };
        serviceEdgeIndex.set(key, se);
        ctx.edges.push(se);
      } else if (r.confidence > se.confidence) {
        se.confidence = r.confidence;
        se.resolution = r.resolution;
      }
      // detail edge: handler → endpoint (or → service when endpoint unknown)
      ctx.edges.push({
        id: `http-detail:${sid}:${call.id}`,
        kind: 'http-detail',
        source: handlerNodeId(sid, call.fromHandler),
        target: r.endpoint ? endpointNodeId(r.service, r.endpoint.id) : r.service,
        fromHandler: handlerNodeId(sid, call.fromHandler),
        endpoint: r.endpoint ? endpointNodeId(r.service, r.endpoint.id) : undefined,
        method: call.method,
        url: call.url,
        status: 'declared',
        resolution: r.resolution,
        confidence: r.confidence,
        location: call.location,
      });
      const targetNode = ctx.nodes.get(r.service);
      if (!r.endpoint && !(targetNode?.kind === 'service' && targetNode.inferred)) {
        ctx.issues.push({
          level: 'info',
          code: 'call:endpoint-unmatched',
          service: sid,
          message: `Resolved ${call.method ?? 'HTTP'} ${call.url} to ${r.service} but no endpoint matched its path`,
          location: call.location,
        });
      }
    }
    for (const d of m.declaredDependencies ?? []) {
      if (!ctx.nodes.has(d.service)) {
        ctx.issues.push({ level: 'warn', code: 'declared:unknown-service', service: sid, message: `Declared dependency on unknown service "${d.service}"` });
        continue;
      }
      const key = `${sid}->${d.service}`;
      if (serviceEdgeIndex.has(key)) continue;
      const e: GraphEdge = { id: `declared:${key}`, kind: 'declared', source: sid, target: d.service, status: 'declared', resolution: 'config', confidence: 1 };
      serviceEdgeIndex.set(key, e);
      ctx.edges.push(e);
    }
  }
  return ctx;
}

function ensureTopic(ctx: BuildContext, broker: Broker, name: string): TopicNode {
  const id = topicNodeId(broker, name);
  let t = ctx.nodes.get(id) as TopicNode | undefined;
  if (!t) {
    t = { id, kind: 'topic', broker, name };
    ctx.nodes.set(id, t);
  }
  return t;
}

function ensureExternal(ctx: BuildContext, host: string): ServiceNode {
  const id = externalNodeId(host);
  let n = ctx.nodes.get(id) as ServiceNode | undefined;
  if (!n) {
    const decl = ctx.config.externals?.[host] ?? ctx.config.externals?.[id];
    n = {
      id,
      kind: 'service',
      name: decl?.name ?? host,
      layer: 'external',
      owner: decl?.owner,
      description: decl?.description ?? `External system at ${host}`,
      tags: decl?.tags,
      inferred: true,
      stats: { endpoints: 0, consumers: 0, calls: 0, publishes: 0 },
    };
    ctx.nodes.set(id, n);
  }
  return n;
}

function serviceIds(ctx: BuildContext): string[] {
  return ctx.manifests.map((m) => m.service.id);
}

/** Resolve an outbound HTTP call to a target service (and endpoint when possible). */
export function resolveCall(ctx: BuildContext, fromService: string, call: HttpCall): Resolution | undefined {
  const parsed = parseCallUrl(call.url);
  const candidates = serviceIds(ctx).filter((id) => id !== fromService);
  const targets = ctx.config.targets ?? {};

  const finish = (service: string, resolution: string, confidence: number): Resolution => {
    const ep = matchEndpoint(ctx, service, call, parsed.path);
    return { service, resolution, confidence: ep ? Math.min(1, confidence + 0.05) : confidence, endpoint: ep };
  };
  const resolveTargetValue = (value: string, resolution: string, confidence: number): Resolution | undefined => {
    if (value.startsWith('external:')) {
      const host = value.slice('external:'.length);
      ensureExternal(ctx, host);
      return { service: externalNodeId(host), resolution, confidence };
    }
    if (!ctx.nodes.has(value)) {
      // Not a manifest we know: treat as an external system named by the id (e.g. "stripe").
      ensureExternal(ctx, value);
      return { service: externalNodeId(value), resolution: `${resolution}-external`, confidence: Math.min(confidence, 0.9) };
    }
    return finish(value, resolution, confidence);
  };

  // a. explicit
  if (call.targetService) {
    const r = resolveTargetValue(call.targetService, 'declared', 1);
    if (r) return r;
  }
  // b. config targets map on hint / host / url
  const probes = [call.targetHint, parsed.host, call.url].filter((x): x is string => !!x);
  for (const [key, value] of Object.entries(targets)) {
    const isRegex = key.length > 2 && key.startsWith('/') && key.endsWith('/');
    const re = isRegex ? new RegExp(key.slice(1, -1), 'i') : undefined;
    for (const probe of probes) {
      const hit = re ? re.test(probe) : probe.toLowerCase() === key.toLowerCase();
      if (hit) {
        const r = resolveTargetValue(value, 'config', 0.95);
        if (r) return r;
      }
    }
  }
  // c. hint token overlap with service ids / names
  if (call.targetHint) {
    const hintTokens = new Set(tokens(call.targetHint));
    if (hintTokens.size) {
      const scored = candidates
        .map((id) => {
          const n = ctx.nodes.get(id) as ServiceNode;
          const st = new Set([...tokens(id), ...tokens(n.name)]);
          let score = 0;
          for (const t of hintTokens) if (st.has(t)) score++;
          return { id, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const top = scored.filter((x) => x.score === scored[0].score);
        if (top.length === 1) return finish(top[0].id, 'hint', 0.8);
        // tie-break by path match
        const byPath = top.filter((x) => matchEndpoint(ctx, x.id, call, parsed.path));
        if (byPath.length === 1) return finish(byPath[0].id, 'hint+path', 0.8);
        ctx.issues.push({ level: 'warn', code: 'call:ambiguous-hint', service: fromService, message: `Hint "${call.targetHint}" matches several services: ${top.map((x) => x.id).join(', ')}`, location: call.location });
      }
    }
  }
  // d. literal external host
  if (parsed.host) {
    const own = candidates.find((id) => tokens(id).every((t) => parsed.host!.includes(t)) && tokens(id).length > 0);
    if (own) return finish(own, 'host-match', 0.7);
    ensureExternal(ctx, parsed.host);
    return { service: externalNodeId(parsed.host), resolution: 'literal-host', confidence: 0.9 };
  }
  // e. unique path match across the estate
  if (parsed.path) {
    const matches: { id: string; ep: HttpEndpoint; score: number }[] = [];
    for (const id of candidates) {
      const ep = matchEndpoint(ctx, id, call, parsed.path);
      if (ep) matches.push({ id, ep, score: matchScore(parsed.path, ep.path) });
    }
    if (matches.length === 1) return { service: matches[0].id, resolution: 'path-match', confidence: 0.7, endpoint: matches[0].ep };
    if (matches.length > 1) {
      matches.sort((a, b) => b.score - a.score);
      if (matches[0].score > matches[1].score) return { service: matches[0].id, resolution: 'path-match', confidence: 0.6, endpoint: matches[0].ep };
      ctx.issues.push({ level: 'warn', code: 'call:ambiguous-path', service: fromService, message: `Path ${parsed.path} matches endpoints in several services: ${matches.map((x) => x.id).join(', ')}; add a targets entry`, location: call.location });
    }
  }
  return undefined;
}

function matchEndpoint(ctx: BuildContext, service: string, call: HttpCall, callPath: string): HttpEndpoint | undefined {
  if (!callPath) return undefined;
  const eps = ctx.endpointsByService.get(service) ?? [];
  let best: HttpEndpoint | undefined;
  let bestScore = -1;
  for (const ep of eps) {
    if (call.method && call.method !== 'ANY' && ep.method !== 'ANY' && ep.method !== call.method) continue;
    if (!pathMatches(callPath, ep.path)) continue;
    const score = matchScore(callPath, ep.path);
    if (score > bestScore) { best = ep; bestScore = score; }
  }
  return best;
}

export function finalizeGraph(ctx: BuildContext, flows: Graph['flows']): Graph {
  const nodes = [...ctx.nodes.values()];
  // Order: manifest services, then inferred externals
  const services = nodes.filter((n): n is ServiceNode => n.kind === 'service').map((n) => n.id);
  return {
    schemaVersion: '1',
    generatedAt: new Date().toISOString(),
    nodes,
    edges: ctx.edges,
    flows,
    issues: ctx.issues,
    services,
  };
}
