#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Graph, ServiceManifest } from '@codegraph/schema';
import { JsonCache } from './cache.js';
import { nameFlows } from './flows.js';
import { AnthropicProvider, createProvider, DEFAULT_MODELS, type ProviderName } from './provider.js';
import { mergeSummaries, planService, runChunksBatch, runChunksSync, type ServiceEnrichmentFile } from './summaries.js';


function usage(): never {
  console.error(`Usage: codegraph-enrich <manifests-dir> --repos <dir> --out <dir> [options]

Repos: <dir>/<service-id> must contain each service's checkout (or pass --repo <id>=<path> per service).

Options:
  --graph <file>           graph.json from the aggregator; enables flow naming
  --out <dir>              Where *.enrich.json files are written (default: ./enrichment)
  --cache <dir>            Cache directory (default: .codegraph-cache/enrich)
  --repo <id>=<path>       Explicit repo path for a service (repeatable)
  --only <id,id>           Limit to these service ids
  --provider <name>        anthropic | copilot (default: anthropic when ANTHROPIC_API_KEY is set, else copilot)
  --model-summaries <id>   Model for handler/endpoint summaries (anthropic: claude-sonnet-5-5, copilot: auto)
  --model-flows <id>       Model for flow naming (anthropic: claude-opus-5-5, copilot: auto)
  --batch                  anthropic only: send summaries through the Message Batches API (50% cheaper, async)
  --dry-run                Print what would be sent (and rough token counts) without calling the API
  --skip-flows             Do not name flows
`);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const opts: Record<string, string | boolean> = {};
  const repoOverrides: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--batch' || a === '--dry-run' || a === '--skip-flows') opts[a.slice(2)] = true;
    else if (a === '--repo') { const [id, p] = (args[++i] ?? '').split('='); repoOverrides[id] = p; }
    else if (a.startsWith('--')) opts[a.slice(2)] = args[++i];
    else positional.push(a);
  }
  if (positional.length !== 1) usage();
  const manifestsDir = resolve(positional[0]);
  const outDir = resolve((opts.out as string) ?? 'enrichment');
  const reposDir = opts.repos ? resolve(opts.repos as string) : undefined;
  const dryRun = !!opts['dry-run'];
  const log = (m: string) => console.error(m);
  const cache = new JsonCache(resolve((opts.cache as string) ?? '.codegraph-cache/enrich'));
  const provider = createProvider(opts.provider as ProviderName | undefined);
  const summaryModel = (opts['model-summaries'] as string) ?? DEFAULT_MODELS[provider.name].summaries;
  const flowModel = (opts['model-flows'] as string) ?? DEFAULT_MODELS[provider.name].flows;
  if (opts.batch && provider.name !== 'anthropic') { console.error('--batch requires --provider anthropic'); process.exit(2); }
  log(`provider: ${provider.name} (summaries: ${summaryModel}, flows: ${flowModel})`);
  const only = opts.only ? new Set((opts.only as string).split(',')) : undefined;
  mkdirSync(outDir, { recursive: true });

  const manifests: ServiceManifest[] = readdirSync(manifestsDir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.enrich.json'))
    .map((f) => JSON.parse(readFileSync(join(manifestsDir, f), 'utf8')) as ServiceManifest)
    .filter((m) => !only || only.has(m.service.id));

  // 1. Per-service summaries
  const summaries = new Map<string, ServiceEnrichmentFile>();
  const allChunks: ReturnType<typeof planService>['chunks'] = [];
  const cachedParts = new Map<string, ReturnType<typeof planService>['cached']>();
  for (const m of manifests) {
    const repoPath = repoOverrides[m.service.id] ?? (reposDir ? join(reposDir, m.service.id) : undefined) ?? (m.service.repo && existsSync(m.service.repo) ? m.service.repo : undefined);
    if (!repoPath || !existsSync(repoPath)) { log(`skip ${m.service.id}: no local repo path`); continue; }
    const plan = planService(m, repoPath, { model: summaryModel, cache, log });
    log(`${m.service.id}: ${plan.cached.length} handler(s) cached, ${plan.chunks.length} request(s) to send`);
    allChunks.push(...plan.chunks);
    cachedParts.set(m.service.id, plan.cached);
  }
  const results = opts.batch
    ? await runChunksBatch((provider as AnthropicProvider).client, allChunks, { model: summaryModel, cache, dryRun, log })
    : await runChunksSync(provider, allChunks, { model: summaryModel, cache, dryRun, log });
  for (const m of manifests) {
    const parts = [...(cachedParts.get(m.service.id) ?? [])];
    for (const c of allChunks) if (c.manifest.service.id === m.service.id && results.has(c.cacheKey)) parts.push(results.get(c.cacheKey)!);
    if (!parts.length) continue;
    const file = mergeSummaries(m, parts);
    summaries.set(m.service.id, file);
    if (!dryRun) writeFileSync(join(outDir, `${m.service.id}.enrich.json`), JSON.stringify(file, null, 2));
  }

  // 2. Flow naming
  if (opts.graph && !opts['skip-flows']) {
    const graph = JSON.parse(readFileSync(resolve(opts.graph as string), 'utf8')) as Graph;
    const flows = await nameFlows(provider, graph, summaries, { model: flowModel, cache, dryRun, log });
    if (!dryRun) writeFileSync(join(outDir, 'flows.enrich.json'), JSON.stringify(flows, null, 2));
  }
  await provider.close();
  log(dryRun ? 'dry run complete (nothing sent)' : `enrichment written to ${outDir}; re-run the aggregator with --enrichment ${outDir}`);
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) console.error('Authentication failed: set ANTHROPIC_API_KEY or run `ant auth login`.');
  else if (err instanceof Anthropic.RateLimitError) console.error('Rate limited; retry later or use --batch.');
  else if (err instanceof Anthropic.APIError) console.error(`API error ${err.status}: ${err.message}`);
  else console.error(err);
  process.exit(1);
});
