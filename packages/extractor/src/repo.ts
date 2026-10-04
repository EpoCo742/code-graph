import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import type { ExtractionIssue } from '@codegraph/schema';
import type { FileFacts, RepoFacts } from './model.js';
import { grammarForFile } from './parser.js';
import { parseCSharp } from './frontends/csharp.js';
import { parseJava } from './frontends/java.js';
import { parseTypeScript } from './frontends/typescript.js';

export const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/bin/**',
  '**/obj/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/.git/**',
  '**/out/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.d.ts',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*Tests/**',
  '**/*.Tests/**',
  '**/src/test/**',
];

const DEFAULT_INCLUDES = ['**/*.cs', '**/*.java', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

export interface LoadOptions {
  include?: string[];
  exclude?: string[];
  verbose?: boolean;
}

export async function loadRepo(root: string, opts: LoadOptions, issues: ExtractionIssue[]): Promise<RepoFacts> {
  const absRoot = path.resolve(root);
  const files = await fg(opts.include?.length ? opts.include : DEFAULT_INCLUDES, {
    cwd: absRoot,
    ignore: [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])],
    onlyFiles: true,
    dot: false,
  });
  files.sort();

  const facts: RepoFacts = {
    root: absRoot,
    files: [],
    units: [],
    unitById: new Map(),
    types: new Map(),
    constants: new Map(),
    refs: new Map(),
    variables: new Map(),
    languages: new Set(),
    dependencies: new Set(),
    packageFiles: [],
  };

  for (const rel of files) {
    const grammar = grammarForFile(rel);
    if (!grammar) continue;
    const abs = path.join(absRoot, rel);
    let source: string;
    try {
      source = await fs.readFile(abs, 'utf8');
    } catch (e) {
      issues.push({ level: 'warn', code: 'read-failed', message: `${rel}: ${(e as Error).message}` });
      continue;
    }
    if (source.length > 2_000_000) {
      issues.push({ level: 'info', code: 'file-skipped', message: `${rel}: too large` });
      continue;
    }
    let ff: FileFacts;
    try {
      if (grammar === 'csharp') ff = await parseCSharp(rel, source);
      else if (grammar === 'java') ff = await parseJava(rel, source);
      else ff = await parseTypeScript(rel, source, grammar);
    } catch (e) {
      issues.push({ level: 'warn', code: 'parse-failed', message: `${rel}: ${(e as Error).message}`, location: { file: rel, line: 1 } });
      continue;
    }
    facts.files.push(ff);
    facts.languages.add(ff.language);
    for (const u of ff.units) {
      if (facts.unitById.has(u.id)) {
        // disambiguate duplicate type/method names across files
        u.id = `${u.file}:${u.id}`;
      }
      facts.unitById.set(u.id, u);
      facts.units.push(u);
    }
    for (const t of ff.types) {
      if (!facts.types.has(t.name)) facts.types.set(t.name, t);
      for (const [k, v] of Object.entries(t.constants)) {
        facts.constants.set(`${t.name}.${k}`, v);
        if (!facts.constants.has(k)) facts.constants.set(k, v);
      }
    }
    for (const [k, v] of Object.entries(ff.constants)) if (!facts.constants.has(k)) facts.constants.set(k, v);
    for (const [k, v] of Object.entries(ff.refs)) {
      facts.refs.set(`${ff.path}:${k}`, v);
      if (!facts.refs.has(k)) facts.refs.set(k, v);
    }
    for (const [k, v] of Object.entries(ff.variables)) {
      if (!v) continue;
      facts.variables.set(`${ff.path}:${k}`, v);
      if (!facts.variables.has(k)) facts.variables.set(k, v);
    }
  }

  // package files for inference
  const pkgFiles = await fg(['package.json', '*.csproj', '**/*.csproj', 'pom.xml', '**/pom.xml', 'build.gradle', 'build.gradle.kts'], {
    cwd: absRoot,
    ignore: DEFAULT_EXCLUDES,
    onlyFiles: true,
    deep: 3,
  });
  for (const rel of pkgFiles.sort()) {
    try {
      const content = await fs.readFile(path.join(absRoot, rel), 'utf8');
      facts.packageFiles.push({ path: rel, content });
      collectDependencies(rel, content, facts.dependencies);
    } catch {
      /* ignore */
    }
  }
  return facts;
}

function collectDependencies(file: string, content: string, deps: Set<string>) {
  const base = path.basename(file);
  if (base === 'package.json') {
    try {
      const pkg = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const d of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) deps.add(d);
    } catch {
      /* ignore */
    }
  } else if (base.endsWith('.csproj')) {
    for (const m of content.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) deps.add(m[1]);
    for (const m of content.matchAll(/<Project\s+Sdk="([^"]+)"/g)) deps.add(m[1]);
  } else if (base === 'pom.xml') {
    for (const m of content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) deps.add(m[1].trim());
  } else if (base.startsWith('build.gradle')) {
    for (const m of content.matchAll(/['"]([a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+)(?::[^'"]+)?['"]/g)) deps.add(m[1].split(':')[1]);
  }
}
