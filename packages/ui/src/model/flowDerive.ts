import type { Flow, GraphEdge } from '@codegraph/schema';
import { GraphModel, layerIndex, refLabel } from './GraphModel';

export interface Participant {
  id: string;
  label: string;
  kind: 'service' | 'topic';
  layer: string;
}

export interface Arrow {
  /** 1-based step number (index into flow.steps + 1). */
  step: number;
  from: string;
  to: string;
  label: string;
  kind: 'http' | 'publish' | 'consume' | 'external' | 'handler' | 'self';
  /** Matching graph edge, when one exists. */
  edge?: GraphEdge;
}

export interface DerivedFlow {
  participants: Participant[];
  arrows: Arrow[];
  subset: { nodes: Set<string>; edges: Set<string> };
  nodeSteps: Map<string, number>;
  edgeSteps: Map<string, number>;
  edgeLabels: Map<string, string>;
}

function findHttpEdge(model: GraphModel, from: string, to: string, ref: string): GraphEdge | undefined {
  const cands = model.out(from).filter((e) => (e.kind === 'http' || e.kind === 'declared') && e.target === to);
  return cands.find((e) => e.endpoint && (e.endpoint === ref || ref.endsWith(e.endpoint))) ?? cands.find((e) => !!e.url && ref.includes(e.url)) ?? cands[0];
}

/**
 * Turn a linear flow into lifelines and arrows. A step's `from` (set by the
 * aggregator) is the arrow source. When it is missing, the caller is inferred
 * from the graph: for an endpoint step in service X, the most recent earlier
 * step whose service has an outbound edge to X.
 */
export function deriveFlow(model: GraphModel, flow: Flow): DerivedFlow {
  const arrows: Arrow[] = [];
  const participantIds: string[] = [];
  const nodeSteps = new Map<string, number>();
  const edgeSteps = new Map<string, number>();
  const edgeLabels = new Map<string, string>();
  const edgeIds = new Set<string>();
  const add = (id: string, step: number) => {
    if (!participantIds.includes(id)) participantIds.push(id);
    if (!nodeSteps.has(id)) nodeSteps.set(id, step);
  };

  const steps = flow.steps;
  let current = flow.entry.service;
  add(current, 1);

  const callerFor = (i: number, target: string): string => {
    for (let j = i - 1; j >= 0; j--) {
      const s = steps[j];
      if (s.kind === 'publish') continue;
      if (s.service === target) continue;
      if (model.out(s.service).some((e) => (e.kind === 'http' || e.kind === 'declared') && e.target === target)) return s.service;
    }
    return current;
  };
  const topicFor = (i: number, consumer: string): string | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      const s = steps[j];
      if (s.kind !== 'publish') continue;
      if (model.out(s.ref).some((e) => e.kind === 'consume' && e.target === consumer)) return s.ref;
    }
    for (let j = i - 1; j >= 0; j--) if (steps[j].kind === 'publish') return steps[j].ref;
    return undefined;
  };

  steps.forEach((s, i) => {
    const n = i + 1;
    const label = s.description ?? refLabel(s.ref);
    if (i === 0) {
      add(s.service, n);
      arrows.push({ step: n, from: s.service, to: s.service, label: s.kind === 'endpoint' ? refLabel(s.ref) : label, kind: 'self' });
      current = s.service;
      return;
    }
    switch (s.kind) {
      case 'publish': {
        const publisher = s.from && model.service(s.from) ? s.from : s.service;
        add(publisher, n);
        add(s.ref, n);
        const edge = model.out(publisher).find((e) => e.kind === 'publish' && e.target === s.ref);
        arrows.push({ step: n, from: publisher, to: s.ref, label: model.topic(s.ref)?.name ?? label, kind: 'publish', edge });
        if (edge) {
          edgeIds.add(edge.id);
          edgeSteps.set(edge.id, n);
        }
        break;
      }
      case 'consumer': {
        add(s.service, n);
        const topic = s.from && model.topic(s.from) ? s.from : topicFor(i, s.service);
        if (topic) {
          add(topic, n);
          const edge = model.out(topic).find((e) => e.kind === 'consume' && e.target === s.service);
          arrows.push({ step: n, from: topic, to: s.service, label, kind: 'consume', edge });
          if (edge) {
            edgeIds.add(edge.id);
            edgeSteps.set(edge.id, n);
          }
        } else {
          arrows.push({ step: n, from: current, to: s.service, label, kind: 'consume' });
        }
        current = s.service;
        break;
      }
      case 'call':
        // A call step annotates the next endpoint/external step; nothing to draw by itself.
        break;
      case 'endpoint':
      case 'external':
      case 'handler': {
        add(s.service, n);
        if (s.service === current && s.kind === 'handler') {
          arrows.push({ step: n, from: current, to: current, label, kind: 'self' });
          break;
        }
        const from = s.from && model.nodes.get(s.from) && s.from !== s.service ? s.from : callerFor(i, s.service);
        const edge = findHttpEdge(model, from, s.service, s.ref);
        const text = s.description && s.kind === 'endpoint' && s.description !== refLabel(s.ref) ? `${s.description} · ${refLabel(s.ref)}` : label;
        arrows.push({ step: n, from, to: s.service, label: text, kind: s.kind === 'external' ? 'external' : s.kind === 'handler' ? 'handler' : 'http', edge });
        if (edge) {
          edgeIds.add(edge.id);
          edgeSteps.set(edge.id, n);
          if (s.description) edgeLabels.set(edge.id, s.description);
        }
        current = s.service;
        break;
      }
    }
  });

  // Order lifelines: services by layer then first appearance; topics right after their first publisher.
  const services = participantIds.filter((id) => model.service(id));
  const topics = participantIds.filter((id) => model.topic(id));
  services.sort((a, b) => layerIndex(model.service(a)!.layer) - layerIndex(model.service(b)!.layer) || nodeSteps.get(a)! - nodeSteps.get(b)!);
  const ordered: string[] = [...services];
  for (const t of topics) {
    const pub = arrows.find((a) => a.kind === 'publish' && a.to === t)?.from;
    const idx = pub ? ordered.indexOf(pub) : -1;
    ordered.splice(idx >= 0 ? idx + 1 : ordered.length, 0, t);
  }
  const participants: Participant[] = ordered.map((id) => {
    const svc = model.service(id);
    if (svc) return { id, label: svc.name, kind: 'service', layer: svc.layer };
    const t = model.topic(id);
    return { id, label: t ? `${t.name}` : id, kind: 'topic', layer: 'topic' };
  });

  return {
    participants,
    arrows,
    subset: { nodes: new Set(participantIds), edges: edgeIds },
    nodeSteps,
    edgeSteps,
    edgeLabels,
  };
}
