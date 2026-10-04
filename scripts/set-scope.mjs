#!/usr/bin/env node
// Rename the npm scope of every workspace package (default @codegraph) to @<org> so the
// packages can be published to GitHub Packages, where the scope must equal the org name.
//   node scripts/set-scope.mjs my-github-org
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const to = process.argv[2];
if (!to) { console.error('usage: node scripts/set-scope.mjs <org>'); process.exit(2); }
const from = process.argv[3] ?? 'codegraph';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'out'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(json|ts|tsx|mjs|yml|yaml|md|npmrc)$/.test(name) || name === '.npmrc') files.push(p);
  }
}
walk(root);
let changed = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const next = text.replaceAll(`@${from}/`, `@${to}/`).replaceAll(`@${from}:registry`, `@${to}:registry`).replaceAll(`--scope=@${from}`, `--scope=@${to}`);
  if (next !== text) { writeFileSync(f, next); changed++; }
}
console.log(`scope @${from} → @${to}: ${changed} file(s) updated. Run npm install to refresh the lockfile.`);
