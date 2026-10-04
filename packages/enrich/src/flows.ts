import type { Flow, Graph } from '@codegraph/schema';
import type { JsonCache } from './cache.js';
import type { Provider } from './provider.js';
import { FLOW_SYSTEM_PROMPT, FlowNamesSchema, PROMPT_VERSION, type FlowNames } from './prompts.js';
import type { ServiceEnrichmentFile } from './summaries.js';

export interface FlowEnrichmentFile {
  flows: Record<string, { name?: string; useCase?: string; description?: string }>;
}

export interface FlowOptions {
  model: string;
  cache: JsonCache;
  dryRun?: boolean;
  /** Flows per request. */
  batchSize?: number;
  log?: (msg: string) => void;
}

/** Compact text for one flow: steps with handler summaries when available. Manifests are never sent. */
export function describeFlow(graph: Graph, f: Flow, summaries: Map<string, ServiceEnrichmentFile>): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const lines = [`flow id="${f.id}" entry=${f.entry.service} ${f.entry.kind} ${f.entry.ref.split('#').pop()}`];
  f.steps.forEach((s, i) => {
    const node = byId.get(s.ref);
    let detail = s.description ?? s.ref;
    let summary = '';
    if (node?.kind === 'endpoint') {
      detail = `${node.method} ${node.path}`;
      summary = summaries.get(node.service)?.endpoints[s.ref.split('#')[1]]?.summary ?? summaries.get(node.service)?.handlers[node.handler]?.summary ?? '';
    } else if (node?.kind === 'handler') {
      summary = summaries.get(node.service)?.handlers[node.name]?.summary ?? '';
    }
    lines.push(`  ${i + 1}. [${s.kind}] ${s.service}: ${detail}${summary ? ` — ${summary}` : ''}`);
  });
  return lines.join('\n');
}

export async function nameFlows(provider: Provider, graph: Graph, summaries: Map<string, ServiceEnrichmentFile>, opts: FlowOptions): Promise<FlowEnrichmentFile> {
  const out: FlowEnrichmentFile = { flows: {} };
  const pending: Flow[] = [];
  for (const f of graph.flows) {
    const key = opts.cache.key(['flow', PROMPT_VERSION, opts.model, describeFlow(graph, f, summaries)]);
    const hit = opts.cache.get<FlowNames['flows'][number]>(key);
    if (hit) out.flows[f.id] = { name: hit.name, useCase: hit.useCase, description: hit.description };
    else pending.push(f);
  }
  opts.log?.(`flows: ${graph.flows.length - pending.length} cached, ${pending.length} to name`);
  const size = opts.batchSize ?? 25;
  for (let i = 0; i < pending.length; i += size) {
    const group = pending.slice(i, i + size);
    const prompt = `Name and describe these flows.\n\n${group.map((f) => describeFlow(graph, f, summaries)).join('\n\n')}`;
    opts.log?.(`  → ${group.length} flow(s), ~${Math.round((prompt.length + FLOW_SYSTEM_PROMPT.length) / 4)} tokens`);
    if (opts.dryRun) continue;
    const res = await provider.complete({ system: FLOW_SYSTEM_PROMPT, prompt, schema: FlowNamesSchema, model: opts.model });
    if (!res.data) { opts.log?.(`  ! ${res.note ?? 'no output'}`); continue; }
    if (res.usage) opts.log?.(`    usage: in=${res.usage.input} cached=${res.usage.cached} out=${res.usage.output}`);
    for (const r of (res.data as FlowNames).flows) {
      const f = group.find((x) => x.id === r.id);
      if (!f) continue;
      out.flows[f.id] = { name: r.name, useCase: r.useCase, description: r.description };
      opts.cache.set(opts.cache.key(['flow', PROMPT_VERSION, opts.model, describeFlow(graph, f, summaries)]), r);
    }
  }
  return out;
}
