#!/usr/bin/env node
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { aggregate, loadAggregateConfig, loadManifests, parseTraceFile, writeDocs } from './index.js';

function usage(): never {
  console.error(`Usage: codegraph-aggregate <manifests-dir|file>... [options]

Options:
  --out <file>          Output graph.json (default: graph.json)
  --config <file>       codegraph.aggregate.yaml / .json
  --traces <file>       Observed service graph (Jaeger dependencies / generic [{source,target}])
  --enrichment <dir>    Directory with *.enrich.json produced by codegraph-enrich
  --docs <dir>          Also write Markdown + Mermaid docs to this directory
  --copy-to <file>      Also copy graph.json to this path (e.g. the UI's public folder)
  --fail-on <level>     Exit 1 when issues at this level exist: error | warn (default: none)
`);
  process.exit(2);
}

function main() {
  const args = process.argv.slice(2);
  const inputs: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) usage();
      opts[a.slice(2)] = v;
      i++;
    } else inputs.push(a);
  }
  if (!inputs.length) usage();

  const config = loadAggregateConfig(opts.config);
  const loaded = loadManifests(inputs.map((p) => resolve(p)));
  console.error(`Loaded ${loaded.length} manifest(s)`);
  const observed = opts.traces ? parseTraceFile(resolve(opts.traces)) : undefined;
  if (observed) console.error(`Loaded ${observed.length} observed edge(s) from traces`);

  const graph = aggregate(loaded.map((l) => l.manifest), { config, observed, enrichmentDir: opts.enrichment ? resolve(opts.enrichment) : undefined });

  const out = resolve(opts.out ?? 'graph.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(graph, null, 2));
  const services = graph.nodes.filter((n) => n.kind === 'service').length;
  const topics = graph.nodes.filter((n) => n.kind === 'topic').length;
  const endpoints = graph.nodes.filter((n) => n.kind === 'endpoint').length;
  const httpEdges = graph.edges.filter((e) => e.kind === 'http').length;
  console.error(`Graph: ${services} services, ${endpoints} endpoints, ${topics} topics, ${httpEdges} http edges, ${graph.flows.length} flows, ${graph.issues.length} issues → ${out}`);

  if (opts['copy-to']) {
    const dest = resolve(opts['copy-to']);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(out, dest);
    console.error(`Copied to ${dest}`);
  }
  if (opts.docs) {
    writeDocs(graph, resolve(opts.docs));
    console.error(`Docs written to ${resolve(opts.docs)}`);
  }
  const warnings = graph.issues.filter((i) => i.level === 'warn' || i.level === 'error');
  for (const i of warnings) console.error(`  [${i.level}] ${i.code}${i.service ? ` ${i.service}` : ''}: ${i.message}`);
  const failOn = opts['fail-on'];
  if (failOn === 'error' && graph.issues.some((i) => i.level === 'error')) process.exit(1);
  if (failOn === 'warn' && warnings.length) process.exit(1);
}

main();
