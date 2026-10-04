#!/usr/bin/env node
// Extract a manifest for every directory under <repoRoot>/samples into <repoRoot>/out/manifests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const samplesDir = path.join(repoRoot, 'samples');
const outDir = path.join(repoRoot, 'out', 'manifests');
await fs.mkdir(outDir, { recursive: true });

const hasConfig = async (dir) => {
  for (const f of ['codegraph.yaml', 'codegraph.yml', 'codegraph.json']) {
    try {
      await fs.access(path.join(dir, f));
      return true;
    } catch {
      /* next */
    }
  }
  return false;
};
const all = (await fs.readdir(samplesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const entries = [];
for (const name of all) if (await hasConfig(path.join(samplesDir, name))) entries.push(name);
let failed = 0;
for (const name of entries) {
  const dir = path.join(samplesDir, name);
  try {
    const { manifest, plugins } = await extract(dir, { includeCommit: false });
    const file = path.join(outDir, `${manifest.service.id}.json`);
    await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    const n = (x) => String(x).padStart(2);
    console.log(
      `${manifest.service.id.padEnd(26)} ${n(manifest.endpoints.length)} endpoints ${n(manifest.consumers.length)} consumers ${n(manifest.calls.length)} calls ${n(manifest.publishes.length)} publishes ${String(manifest.handlers.length).padStart(3)} handlers  [${plugins.join(', ')}]`,
    );
  } catch (e) {
    failed++;
    console.error(`${name}: FAILED: ${e.stack ?? e}`);
  }
}
console.log(`wrote ${entries.length - failed}/${entries.length} manifests to ${path.relative(repoRoot, outDir)}`);
if (failed) process.exit(1);
