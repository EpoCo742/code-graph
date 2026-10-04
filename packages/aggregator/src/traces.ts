import { readFileSync } from 'node:fs';
import type { GraphEdge, ServiceNode } from '@codegraph/schema';
import type { BuildContext } from './build.js';
import { externalNodeId } from './build.js';
import { tokens } from './paths.js';

/**
 * Observed service-to-service calls from a tracing backend.
 * Accepted shapes:
 *  - Jaeger `/api/dependencies`: { data: [{ parent, child, callCount }] }
 *  - Generic: [{ source, target, count? }] or [{ parent, child }]
 *  - Grafana Tempo service graph export: [{ client, server, count? }]
 */
export interface ObservedEdge {
  source: string;
  target: string;
  count?: number;
}

export function parseTraceFile(path: string): ObservedEdge[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const rows: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const out: ObservedEdge[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const source = (r.source ?? r.parent ?? r.client) as string | undefined;
    const target = (r.target ?? r.child ?? r.server) as string | undefined;
    if (!source || !target) continue;
    out.push({ source, target, count: typeof r.count === 'number' ? r.count : typeof r.callCount === 'number' ? r.callCount : undefined });
  }
  return out;
}

/** Merge observed edges into the graph: mark matching http edges 'both', add trace-only edges as 'observed'. */
export function mergeTraces(ctx: BuildContext, observed: ObservedEdge[]) {
  const map = ctx.config.traceServiceMap ?? {};
  const serviceIds = [...ctx.nodes.values()].filter((n): n is ServiceNode => n.kind === 'service').map((n) => n.id);

  const resolveName = (name: string): string => {
    if (map[name]) return map[name];
    if (ctx.nodes.has(name)) return name;
    const nt = tokens(name);
    const hits = serviceIds.filter((id) => {
      const st = tokens(id);
      return nt.length && st.length && nt.every((t) => st.includes(t));
    });
    if (hits.length === 1) return hits[0];
    // unknown → external node named after the trace service
    const id = externalNodeId(name);
    if (!ctx.nodes.has(id)) {
      ctx.nodes.set(id, {
        id, kind: 'service', name, layer: 'external', inferred: true,
        description: `Seen only in traces as "${name}"`,
        stats: { endpoints: 0, consumers: 0, calls: 0, publishes: 0 },
      });
      ctx.issues.push({ level: 'info', code: 'trace:unknown-service', message: `Trace service "${name}" has no manifest; added as external` });
    }
    return id;
  };

  const httpEdges = new Map<string, GraphEdge>();
  for (const e of ctx.edges) if (e.kind === 'http' || e.kind === 'declared') httpEdges.set(`${e.source}->${e.target}`, e);

  const observedKeys = new Set<string>();
  for (const o of observed) {
    const s = resolveName(o.source);
    const t = resolveName(o.target);
    if (s === t) continue;
    const key = `${s}->${t}`;
    observedKeys.add(key);
    const existing = httpEdges.get(key);
    if (existing) {
      existing.status = 'both';
      existing.confidence = 1;
    } else {
      const e: GraphEdge = {
        id: `http:${key}`,
        kind: 'http',
        source: s,
        target: t,
        status: 'observed',
        resolution: 'trace',
        confidence: 0.85,
      };
      httpEdges.set(key, e);
      ctx.edges.push(e);
      ctx.issues.push({ level: 'warn', code: 'drift:observed-only', service: s, message: `Traces show ${s} calling ${t} but static analysis found no such call` });
    }
  }
  for (const [key, e] of httpEdges) {
    if (e.status === 'declared' && !observedKeys.has(key) && !e.target.startsWith('external:')) {
      ctx.issues.push({ level: 'info', code: 'drift:declared-only', service: e.source, message: `Static analysis found ${e.source} → ${e.target} but traces never observed it` });
    }
  }
}
