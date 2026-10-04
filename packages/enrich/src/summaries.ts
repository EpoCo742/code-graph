import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ServiceManifest } from '@codegraph/schema';
import type { JsonCache } from './cache.js';
import type { Provider } from './provider.js';
import { PROMPT_VERSION, SERVICE_SYSTEM_PROMPT, ServiceSummarySchema, type ServiceSummary } from './prompts.js';
import { sliceHandlers, type Slice } from './slice.js';

export interface ServiceEnrichmentFile {
  service: string;
  description?: string;
  handlers: Record<string, { summary: string; hash?: string }>;
  endpoints: Record<string, { summary: string; useCase?: string }>;
}

export interface SummaryOptions {
  model: string;
  cache: JsonCache;
  /** Max characters of source per request; larger services are chunked. */
  maxCharsPerRequest?: number;
  dryRun?: boolean;
  log?: (msg: string) => void;
}

interface Chunk {
  manifest: ServiceManifest;
  slices: Slice[];
  cacheKey: string;
}

/**
 * Decide which handlers deserve a summary: endpoint handlers, consumer handlers
 * and anything that reaches an outbound call or publish. Pure plumbing is skipped.
 */
export function interestingHandlers(m: ServiceManifest): Set<string> {
  const effects = new Set<string>([...m.calls.map((c) => c.fromHandler), ...m.publishes.map((p) => p.fromHandler)]);
  const callers = new Map<string, string[]>();
  for (const h of m.handlers) for (const c of h.calls) callers.set(c, [...(callers.get(c) ?? []), h.id]);
  // propagate "has effects" upward through callers
  const stack = [...effects];
  while (stack.length) {
    const id = stack.pop()!;
    for (const caller of callers.get(id) ?? []) if (!effects.has(caller)) { effects.add(caller); stack.push(caller); }
  }
  for (const e of m.endpoints) effects.add(e.handler);
  for (const c of m.consumers) effects.add(c.handler);
  return effects;
}

/** Build the user prompt for one chunk: compact manifest facts + source slices. */
export function buildServicePrompt(m: ServiceManifest, slices: Slice[]): string {
  const ids = new Set(slices.map((s) => s.handlerId));
  const lines: string[] = [];
  lines.push(`# Service: ${m.service.id} (${m.service.name}), layer=${m.service.layer}${m.service.language ? `, language=${m.service.language}` : ''}`);
  const eps = m.endpoints.filter((e) => ids.has(e.handler));
  if (eps.length) lines.push(`\n## Endpoints\n${eps.map((e) => `- id="${e.id}" ${e.method} ${e.path} -> ${e.handler}`).join('\n')}`);
  const cons = m.consumers.filter((c) => ids.has(c.handler));
  if (cons.length) lines.push(`\n## Consumers\n${cons.map((c) => `- ${c.broker} ${c.topic}${c.routingKey ? ` (${c.routingKey})` : ''} -> ${c.handler}`).join('\n')}`);
  const calls = m.calls.filter((c) => ids.has(c.fromHandler));
  if (calls.length) lines.push(`\n## Outbound HTTP\n${calls.map((c) => `- ${c.fromHandler}: ${c.method ?? 'HTTP'} ${c.url}${c.targetService ? ` -> ${c.targetService}` : c.targetHint ? ` (hint ${c.targetHint})` : ''}`).join('\n')}`);
  const pubs = m.publishes.filter((p) => ids.has(p.fromHandler));
  if (pubs.length) lines.push(`\n## Publishes\n${pubs.map((p) => `- ${p.fromHandler}: ${p.broker} ${p.topic}${p.routingKey ? ` (${p.routingKey})` : ''}`).join('\n')}`);
  const graph = m.handlers.filter((h) => ids.has(h.id) && h.calls.length);
  if (graph.length) lines.push(`\n## Handler call graph\n${graph.map((h) => `- ${h.id} -> ${h.calls.join(', ')}`).join('\n')}`);
  lines.push(`\n## Source slices (handler id, then code)`);
  for (const s of slices) lines.push(`\n### ${s.handlerId} (${s.file}:${s.startLine}-${s.endLine})\n\`\`\`\n${s.text}\n\`\`\``);
  lines.push(`\nSummarise every handler id listed above and every endpoint id listed above.`);
  return lines.join('\n');
}

/** Plan the requests for a service: cached results are reused, remaining handlers are chunked. */
export function planService(m: ServiceManifest, repoPath: string, opts: SummaryOptions): { chunks: Chunk[]; cached: ServiceSummary[] } {
  const wanted = interestingHandlers(m);
  const slices = sliceHandlers(repoPath, m, wanted);
  const maxChars = opts.maxCharsPerRequest ?? 60_000;
  const cached: ServiceSummary[] = [];
  const pending: Slice[] = [];
  for (const s of slices) {
    const h = m.handlers.find((x) => x.id === s.handlerId)!;
    const key = opts.cache.key(['handler', PROMPT_VERSION, opts.model, m.service.id, s.handlerId, h.hash ?? s.text]);
    const hit = opts.cache.get<ServiceSummary>(key);
    if (hit) cached.push(hit);
    else pending.push(s);
  }
  const chunks: Chunk[] = [];
  let cur: Slice[] = [];
  let size = 0;
  for (const s of pending) {
    if (cur.length && size + s.text.length > maxChars) { chunks.push(mk(cur)); cur = []; size = 0; }
    cur.push(s);
    size += s.text.length;
  }
  if (cur.length) chunks.push(mk(cur));
  return { chunks, cached };

  function mk(sl: Slice[]): Chunk {
    return { manifest: m, slices: sl, cacheKey: opts.cache.key(['chunk', PROMPT_VERSION, opts.model, m.service.id, sl.map((s) => s.handlerId)]) };
  }
}

export function requestParams(chunk: Chunk, model: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: SERVICE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildServicePrompt(chunk.manifest, chunk.slices) }],
    output_config: { format: zodOutputFormat(ServiceSummarySchema) },
  };
}

/** Store per-handler results so a later run with one changed handler re-sends only that handler. */
export function storeChunkResult(chunk: Chunk, result: ServiceSummary, opts: SummaryOptions) {
  for (const s of chunk.slices) {
    const h = chunk.manifest.handlers.find((x) => x.id === s.handlerId)!;
    const key = opts.cache.key(['handler', PROMPT_VERSION, opts.model, chunk.manifest.service.id, s.handlerId, h.hash ?? s.text]);
    const sub: ServiceSummary = {
      description: result.description,
      handlers: result.handlers.filter((x) => x.id === s.handlerId),
      endpoints: result.endpoints.filter((e) => chunk.manifest.endpoints.some((ep) => ep.id === e.id && ep.handler === s.handlerId)),
    };
    opts.cache.set(key, sub);
  }
}

export function mergeSummaries(m: ServiceManifest, parts: ServiceSummary[]): ServiceEnrichmentFile {
  const file: ServiceEnrichmentFile = { service: m.service.id, handlers: {}, endpoints: {} };
  for (const p of parts) {
    if (p.description && !file.description) file.description = p.description;
    for (const h of p.handlers) file.handlers[h.id] = { summary: h.summary, hash: m.handlers.find((x) => x.id === h.id)?.hash };
    for (const e of p.endpoints) file.endpoints[e.id] = { summary: e.summary, useCase: e.useCase };
  }
  return file;
}

/** Run chunks synchronously (one request each) through any provider. */
export async function runChunksSync(provider: Provider, chunks: Chunk[], opts: SummaryOptions): Promise<Map<string, ServiceSummary>> {
  const out = new Map<string, ServiceSummary>();
  for (const chunk of chunks) {
    const prompt = buildServicePrompt(chunk.manifest, chunk.slices);
    opts.log?.(`  → ${chunk.manifest.service.id}: ${chunk.slices.length} handler(s), ~${Math.round((prompt.length + SERVICE_SYSTEM_PROMPT.length) / 4)} tokens`);
    if (opts.dryRun) continue;
    const res = await provider.complete({ system: SERVICE_SYSTEM_PROMPT, prompt, schema: ServiceSummarySchema, model: opts.model });
    if (!res.data) { opts.log?.(`  ! ${chunk.manifest.service.id}: ${res.note ?? 'no output'}`); continue; }
    if (res.usage) opts.log?.(`    usage: in=${res.usage.input} cached=${res.usage.cached} out=${res.usage.output}`);
    out.set(chunk.cacheKey, res.data);
    storeChunkResult(chunk, res.data, opts);
  }
  return out;
}

/** Run chunks through the Message Batches API (50% cheaper, async). Polls until done. */
export async function runChunksBatch(client: Anthropic, chunks: Chunk[], opts: SummaryOptions, pollMs = 30_000): Promise<Map<string, ServiceSummary>> {
  const out = new Map<string, ServiceSummary>();
  if (!chunks.length) return out;
  const byId = new Map(chunks.map((c) => [c.cacheKey, c]));
  const requests = chunks.map((c) => ({ custom_id: c.cacheKey, params: requestParams(c, opts.model) }));
  opts.log?.(`  → batch of ${requests.length} request(s), ~${Math.round(JSON.stringify(requests).length / 4)} tokens`);
  if (opts.dryRun) return out;
  const batch = await client.messages.batches.create({ requests });
  opts.log?.(`  batch ${batch.id} created`);
  let status = batch;
  while (status.processing_status !== 'ended') {
    await new Promise((r) => setTimeout(r, pollMs));
    status = await client.messages.batches.retrieve(batch.id);
    opts.log?.(`  batch ${batch.id}: ${status.processing_status} (${status.request_counts.processing} processing)`);
  }
  for await (const r of await client.messages.batches.results(batch.id)) {
    const chunk = byId.get(r.custom_id);
    if (!chunk) continue;
    if (r.result.type !== 'succeeded') { opts.log?.(`  ! ${r.custom_id}: ${r.result.type}`); continue; }
    const text = r.result.message.content.find((b) => b.type === 'text')?.text ?? '';
    const parsed = ServiceSummarySchema.safeParse(safeJson(text));
    if (!parsed.success) { opts.log?.(`  ! ${r.custom_id}: output did not match schema`); continue; }
    out.set(chunk.cacheKey, parsed.data);
    storeChunkResult(chunk, parsed.data, opts);
  }
  return out;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

export type { Chunk };
