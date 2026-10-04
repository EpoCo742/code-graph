import type { Flow, FlowStep, GraphEdge, ServiceManifest } from '@codegraph/schema';
import type { BuildContext } from './build.js';
import { endpointNodeId, handlerNodeId } from './build.js';

/**
 * Derive end-to-end flows structurally:
 *   entry (endpoint | consumer | ui handler)
 *     → transitive internal handler calls
 *       → each outbound HTTP call → target endpoint → recurse
 *       → each publish → topic → each consumer → recurse
 */
export function deriveFlows(ctx: BuildContext): Flow[] {
  const maxDepth = ctx.config.flows?.maxDepth ?? 8;
  const includeNonRoots = ctx.config.flows?.includeNonRoots ?? false;
  const byService = new Map(ctx.manifests.map((m) => [m.service.id, m]));

  // Index edges
  const detailByHandler = new Map<string, GraphEdge[]>(); // handler node id → http-detail edges
  const publishByHandler = new Map<string, GraphEdge[]>();
  const consumersByTopic = new Map<string, GraphEdge[]>();
  const calledEndpoints = new Set<string>(); // endpoint node ids called by another service
  for (const e of ctx.edges) {
    if (e.kind === 'http-detail' && e.fromHandler) {
      push(detailByHandler, e.fromHandler, e);
      if (e.endpoint) calledEndpoints.add(e.endpoint);
    } else if (e.kind === 'publish' && e.fromHandler) push(publishByHandler, e.fromHandler, e);
    else if (e.kind === 'consume') push(consumersByTopic, e.source, e);
  }
  const topicHasInternalPublisher = new Set(ctx.edges.filter((e) => e.kind === 'publish').map((e) => e.target));

  /** Handlers reachable from a handler within one service, in DFS order (including itself). */
  function reachableHandlers(m: ServiceManifest, start: string): string[] {
    const handlers = new Map(m.handlers.map((h) => [h.id, h]));
    const seen = new Set<string>();
    const order: string[] = [];
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
      for (const c of handlers.get(id)?.calls ?? []) visit(c);
    };
    visit(start);
    return order;
  }

  /** Expand what a handler in a service triggers, appending steps. */
  function expand(service: string, handlerId: string, steps: FlowStep[], depth: number, visiting: Set<string>) {
    const m = byService.get(service);
    if (!m) return;
    const key = `${service}#${handlerId}`;
    if (visiting.has(key) || depth > maxDepth) return;
    visiting.add(key);
    for (const h of reachableHandlers(m, handlerId)) {
      const hn = handlerNodeId(service, h);
      for (const e of detailByHandler.get(hn) ?? []) {
        const targetService = e.endpoint ? (ctx.nodes.get(e.endpoint) as { service: string }).service : e.target;
        const targetNode = ctx.nodes.get(targetService);
        const isExternal = targetNode?.kind === 'service' && targetNode.layer === 'external';
        steps.push({
          service: targetService,
          ref: e.endpoint ?? e.target,
          kind: isExternal ? 'external' : e.endpoint ? 'endpoint' : 'call',
          from: service,
          description: `${e.method ?? 'HTTP'} ${e.url ?? ''}`.trim(),
        });
        if (e.endpoint) {
          const ep = ctx.nodes.get(e.endpoint) as { handler: string; service: string };
          expand(ep.service, ep.handler, steps, depth + 1, visiting);
        }
      }
      for (const p of publishByHandler.get(hn) ?? []) {
        steps.push({ service, ref: p.target, kind: 'publish', from: service, description: `publish ${p.target.split(':').slice(2).join(':')}${p.routingKey ? ` (${p.routingKey})` : ''}` });
        for (const c of consumersByTopic.get(p.target) ?? []) {
          const consumerHandler = c.fromHandler!.slice(c.target.length + 1);
          steps.push({ service: c.target, ref: c.id, kind: 'consumer', from: p.target, description: `consume ${p.target.split(':').slice(2).join(':')}` });
          expand(c.target, consumerHandler, steps, depth + 1, visiting);
        }
      }
    }
    visiting.delete(key);
  }

  const flows: Flow[] = [];
  const seenIds = new Set<string>();
  const addFlow = (f: Flow) => {
    if (seenIds.has(f.id)) return;
    seenIds.add(f.id);
    flows.push(f);
  };

  for (const m of ctx.manifests) {
    const sid = m.service.id;
    // Endpoint entries (roots unless includeNonRoots)
    for (const ep of m.endpoints) {
      const epNode = endpointNodeId(sid, ep.id);
      if (!includeNonRoots && calledEndpoints.has(epNode)) continue;
      const steps: FlowStep[] = [{ service: sid, ref: epNode, kind: 'endpoint', description: `${ep.method} ${ep.path}` }];
      expand(sid, ep.handler, steps, 0, new Set());
      if (steps.length < 2) continue; // nothing cross-service
      addFlow({ id: slug(`flow-${sid}-${ep.method}-${ep.path}`), name: `${ep.method} ${ep.path}`, entry: { service: sid, kind: 'endpoint', ref: epNode }, steps });
    }
    // Consumer entries whose topic has no in-estate publisher (externally triggered)
    for (const c of m.consumers) {
      const edge = ctx.edges.find((e) => e.kind === 'consume' && e.id === `consume:${sid}:${c.id}`);
      if (!edge || topicHasInternalPublisher.has(edge.source)) continue;
      const steps: FlowStep[] = [{ service: sid, ref: edge.id, kind: 'consumer', description: `consume ${c.topic}` }];
      expand(sid, c.handler, steps, 0, new Set());
      if (steps.length < 2) continue;
      addFlow({ id: slug(`flow-${sid}-consume-${c.topic}`), name: `on ${c.topic}`, entry: { service: sid, kind: 'consumer', ref: edge.id }, steps });
    }
    // UI-layer handlers that make calls (no endpoints of their own)
    if (m.service.layer === 'ui') {
      for (const h of m.handlers) {
        const hn = handlerNodeId(sid, h.id);
        if (!detailByHandler.has(hn)) continue;
        const steps: FlowStep[] = [{ service: sid, ref: hn, kind: 'handler', description: h.name }];
        expand(sid, h.id, steps, 0, new Set());
        if (steps.length < 2) continue;
        addFlow({ id: slug(`flow-${sid}-${h.id}`), name: `${m.service.name}: ${h.name}`, entry: { service: sid, kind: 'handler', ref: hn }, steps });
      }
    }
  }
  flows.sort((a, b) => b.steps.length - a.steps.length || a.name.localeCompare(b.name));
  return flows;
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const arr = map.get(k);
  if (arr) arr.push(v);
  else map.set(k, [v]);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
