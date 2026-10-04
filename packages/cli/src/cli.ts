#!/usr/bin/env node
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { scan } from './scan.js';
import { serve } from './serve.js';

const HELP = `codegraph: map application flows across many repositories.

Usage:
  codegraph scan <root>... [options]     Extract every repo under the roots, aggregate, write graph + docs
  codegraph serve [options]              Serve the explorer UI for an existing graph.json
  codegraph open <root>... [options]     scan, then serve and open the browser

Options:
  --out <dir>            Output directory (default: ./codegraph-out)
  --depth <n>            How deep below each root to look for repos (default: 2)
  --configured-only      Only repos that contain a codegraph.yaml (default: any git repo too)
  --config <file>        codegraph.aggregate.yaml with cross-cutting resolution rules
  --traces <file>        Observed service graph export (Jaeger dependencies or [{source,target}])
  --enrichment <dir>     Directory with *.enrich.json from codegraph-enrich
  --no-docs              Skip Markdown/Mermaid docs
  --graph <file>         serve: graph.json to serve (default: <out>/graph.json)
  --port <n>             serve/open: port (default: 4173)
  --verbose

Examples:
  codegraph scan ~/src --config ~/src/codegraph-catalog/codegraph.aggregate.yaml
  codegraph open ~/src/orders-* ~/src/inventory-*
  codegraph serve --graph codegraph-out/graph.json
`;

function parse(argv: string[]) {
  const positional: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--configured-only' || a === '--no-docs' || a === '--verbose' || a === '--help' || a === '-h') opts[a.replace(/^-+/, '')] = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i] ?? '';
    else positional.push(a);
  }
  return { positional, opts };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, opts } = parse(rest);
  const log = (m: string) => console.error(m);
  if (!cmd || opts.help || opts.h) { console.log(HELP); process.exit(cmd ? 0 : 2); }
  const out = resolve((opts.out as string) ?? 'codegraph-out');

  if (cmd === 'scan' || cmd === 'open') {
    if (!positional.length) { console.error('scan: give at least one root directory'); process.exit(2); }
    await scan({
      roots: positional,
      out,
      depth: opts.depth ? Number(opts.depth) : undefined,
      configuredOnly: !!opts['configured-only'],
      configPath: opts.config as string | undefined,
      tracesPath: opts.traces as string | undefined,
      enrichmentDir: opts.enrichment as string | undefined,
      docs: !opts['no-docs'],
      verbose: !!opts.verbose,
      log,
    });
    if (cmd === 'scan') return;
  }
  if (cmd === 'serve' || cmd === 'open') {
    const { url } = await serve({ graphPath: (opts.graph as string) ?? resolve(out, 'graph.json'), port: opts.port ? Number(opts.port) : undefined, log });
    if (cmd === 'open') {
      const opener = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(opener);
    }
    log('press Ctrl+C to stop');
    return; // keep process alive while the server runs
  }
  console.error(`unknown command: ${cmd}\n`);
  console.log(HELP);
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
