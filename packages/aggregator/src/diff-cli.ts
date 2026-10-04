#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertValidManifest } from '@codegraph/schema';
import { diffManifests, diffToMarkdown } from './diff.js';

function usage(): never {
  console.error(`Usage: codegraph-diff <before.json|missing> <after.json> [--json] [--fail-on-new-deps]

Compares two manifests of the same service. Pass a non-existent path as <before> for a new service.
Prints Markdown (default) or JSON. --fail-on-new-deps exits 3 when a new outbound call/publish appears.`);
  process.exit(2);
}

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
if (files.length !== 2) usage();
const [beforePath, afterPath] = files.map((f) => resolve(f));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));
assertValidManifest(after);
let before: typeof after | undefined;
if (existsSync(beforePath)) {
  before = JSON.parse(readFileSync(beforePath, 'utf8'));
  assertValidManifest(before);
}
const d = diffManifests(before, after);
console.log(args.includes('--json') ? JSON.stringify(d, null, 2) : diffToMarkdown(d));
if (args.includes('--fail-on-new-deps') && d.newDependencies) process.exit(3);
