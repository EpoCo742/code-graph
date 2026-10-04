import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { extract } from '@codegraph/extractor';
import { aggregate, loadAggregateConfig, loadManifests, parseTraceFile, writeDocs } from '@codegraph/aggregator';
import type { Graph, ServiceManifest } from '@codegraph/schema';

export interface ScanOptions {
  roots: string[];
  out: string;
  /** How deep below each root to look for repositories. Default 2. */
  depth?: number;
  /** Only directories with a codegraph.yaml (default: any git repo or codegraph.yaml). */
  configuredOnly?: boolean;
  configPath?: string;
  tracesPath?: string;
  enrichmentDir?: string;
  docs?: boolean;
  verbose?: boolean;
  log?: (msg: string) => void;
}

export interface ScanResult {
  repos: { path: string; serviceId?: string; manifest?: string; error?: string }[];
  graph: Graph;
  graphPath: string;
  manifestsDir: string;
}

const CONFIG_NAMES = ['codegraph.yaml', 'codegraph.yml', 'codegraph.json'];
const SKIP = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'build', 'target', 'out', '.codegraph-cache']);

function isRepo(dir: string, configuredOnly: boolean): boolean {
  if (CONFIG_NAMES.some((n) => existsSync(join(dir, n)))) return true;
  return !configuredOnly && existsSync(join(dir, '.git'));
}

/** Find candidate repositories under the given roots. */
export function findRepos(roots: string[], depth = 2, configuredOnly = false): string[] {
  const found: string[] = [];
  const visit = (dir: string, level: number) => {
    if (isRepo(dir, configuredOnly)) { found.push(dir); return; }
    if (level >= depth) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      if (SKIP.has(name) || name.startsWith('.')) continue;
      const p = join(dir, name);
      try { if (statSync(p).isDirectory()) visit(p, level + 1); } catch { /* ignore */ }
    }
  };
  for (const r of roots) visit(resolve(r), 0);
  return [...new Set(found)];
}

/** Extract every repo, aggregate, and write graph (+docs). */
export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const log = opts.log ?? (() => {});
  const out = resolve(opts.out);
  const manifestsDir = join(out, 'manifests');
  mkdirSync(manifestsDir, { recursive: true });
  const repos = findRepos(opts.roots, opts.depth ?? 2, opts.configuredOnly ?? false);
  log(`found ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}`);
  const results: ScanResult['repos'] = [];
  const manifests: ServiceManifest[] = [];
  for (const repo of repos) {
    try {
      const r = await extract(repo, { verbose: opts.verbose });
      const file = join(manifestsDir, `${r.manifest.service.id}.json`);
      writeFileSync(file, JSON.stringify(r.manifest, null, 2));
      manifests.push(r.manifest);
      const m = r.manifest;
      log(`  ${m.service.id.padEnd(28)} ${String(m.endpoints.length).padStart(3)} ep ${String(m.consumers.length).padStart(3)} sub ${String(m.calls.length).padStart(3)} calls ${String(m.publishes.length).padStart(3)} pub  (${basename(repo)})`);
      results.push({ path: repo, serviceId: m.service.id, manifest: file });
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      log(`  ! ${basename(repo)}: ${msg}`);
      results.push({ path: repo, error: msg });
    }
  }
  const config = loadAggregateConfig(opts.configPath);
  const observed = opts.tracesPath ? parseTraceFile(resolve(opts.tracesPath)) : undefined;
  // Re-load from disk so duplicate ids are caught the same way as in CI.
  const loaded = loadManifests([manifestsDir]).map((l) => l.manifest);
  const graph = aggregate(loaded, { config, observed, enrichmentDir: opts.enrichmentDir ? resolve(opts.enrichmentDir) : undefined });
  const graphPath = join(out, 'graph.json');
  writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  if (opts.docs !== false) writeDocs(graph, join(out, 'docs'));
  const services = graph.nodes.filter((n) => n.kind === 'service').length;
  const warnings = graph.issues.filter((i) => i.level !== 'info');
  log(`graph: ${services} services, ${graph.nodes.filter((n) => n.kind === 'endpoint').length} endpoints, ${graph.nodes.filter((n) => n.kind === 'topic').length} topics, ${graph.edges.filter((e) => e.kind === 'http').length} http edges, ${graph.flows.length} flows, ${warnings.length} warning(s) → ${graphPath}`);
  for (const i of warnings) log(`  [${i.level}] ${i.code}${i.service ? ` ${i.service}` : ''}: ${i.message}`);
  return { repos: results, graph, graphPath, manifestsDir };
}
