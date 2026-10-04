#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { LAYERS, type Layer } from '@codegraph/schema';
import { extract } from './index.js';

function usage(): never {
  console.error(`Usage: codegraph-extract <repoPath> [options]

Options:
  --out <file>         Write manifest to file (default: stdout)
  --config <file>      Extractor config (default: <repo>/codegraph.yaml)
  --service-id <id>    Override service id
  --layer <layer>      Override layer (${LAYERS.join('|')})
  --no-prune           Keep all code units as handlers
  --verbose            Log plugin selection and stats to stderr
  -h, --help           Show help`);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) usage();
  let repoPath: string | undefined;
  let out: string | undefined;
  let configPath: string | undefined;
  let serviceId: string | undefined;
  let layer: Layer | undefined;
  let verbose = false;
  let noPrune = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out = args[++i];
    else if (a === '--config') configPath = args[++i];
    else if (a === '--service-id') serviceId = args[++i];
    else if (a === '--layer') {
      const l = args[++i] as Layer;
      if (!LAYERS.includes(l)) usage();
      layer = l;
    } else if (a === '--verbose') verbose = true;
    else if (a === '--no-prune') noPrune = true;
    else if (a.startsWith('-')) usage();
    else repoPath = a;
  }
  if (!repoPath) usage();
  const result = await extract(repoPath, { configPath, serviceId, layer, verbose, noPrune });
  const json = JSON.stringify(result.manifest, null, 2);
  if (out) {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fs.writeFile(out, json + '\n', 'utf8');
  } else {
    process.stdout.write(json + '\n');
  }
  const m = result.manifest;
  const errors = (m.issues ?? []).filter((i) => i.level === 'error');
  if (verbose || out) {
    console.error(
      `${m.service.id}: ${m.endpoints.length} endpoints, ${m.consumers.length} consumers, ${m.calls.length} calls, ${m.publishes.length} publishes, ${m.handlers.length} handlers` +
        ` (${result.stats.files} files, plugins: ${result.plugins.join(', ') || 'none'}, issues: ${m.issues?.length ?? 0})`,
    );
  }
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e.code}: ${e.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error((e as Error).stack ?? String(e));
  process.exit(1);
});
