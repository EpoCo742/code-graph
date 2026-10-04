import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepos, scan } from './scan.js';
import { serve } from './serve.js';
import { packageSite } from './package.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const samples = join(repoRoot, 'samples');

test('findRepos discovers the sample services', () => {
  const repos = findRepos([samples], 2, true);
  assert.equal(repos.length, 10);
  assert.ok(repos.every((r) => existsSync(join(r, 'codegraph.yaml'))));
});

test('scan extracts, aggregates and writes graph + docs', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cg-scan-'));
  const res = await scan({
    roots: [samples],
    out,
    configuredOnly: true,
    configPath: join(samples, 'codegraph.aggregate.yaml'),
    tracesPath: join(samples, 'codegraph.traces.json'),
  });
  assert.equal(res.repos.filter((r) => r.error).length, 0);
  assert.equal(res.graph.nodes.filter((n) => n.kind === 'service').length, 13);
  assert.ok(res.graph.flows.length >= 6);
  assert.ok(existsSync(join(out, 'docs', 'index.md')));
  const written = JSON.parse(readFileSync(res.graphPath, 'utf8'));
  assert.equal(written.schemaVersion, '1');
});

test('serve returns the graph and the explorer index', async (t) => {
  const uiIndex = join(repoRoot, 'packages', 'ui', 'dist', 'index.html');
  if (!existsSync(uiIndex)) { t.skip('UI not built'); return; }
  const out = mkdtempSync(join(tmpdir(), 'cg-serve-'));
  const { graphPath } = await scan({ roots: [samples], out, configuredOnly: true, docs: false });
  const { url, close } = await serve({ graphPath, port: 0 });
  try {
    const g = await fetch(new URL('/graph.json', url)).then((r) => r.json());
    assert.equal(g.schemaVersion, '1');
    const html = await fetch(url).then((r) => r.text());
    assert.ok(html.includes('<div id="root">') || html.includes('id="root"'));
    const deep = await fetch(new URL('/some/client/route', url)).then((r) => r.text());
    assert.ok(deep.includes('root'));
  } finally {
    close();
  }
});

test('package assembles a static site with a PCF manifest', async (t) => {
  const uiIndex = join(repoRoot, 'packages', 'ui', 'dist', 'index.html');
  if (!existsSync(uiIndex)) { t.skip('UI not built'); return; }
  const out = mkdtempSync(join(tmpdir(), 'cg-pkg-'));
  const { graphPath } = await scan({ roots: [samples], out, configuredOnly: true, docs: true });
  const site = packageSite({ graphPath, out: join(out, 'site'), docsDir: join(out, 'docs'), appName: 'flow-map', htpasswd: 'user:$apr1$x$y' });
  for (const f of ['index.html', 'graph.json', 'manifest.yml', 'Staticfile', 'Staticfile.auth', 'nginx/conf/includes/codegraph.conf', 'docs/index.md']) {
    assert.ok(existsSync(join(site.out, f)), `missing ${f}`);
  }
  const manifest = readFileSync(join(site.out, 'manifest.yml'), 'utf8');
  assert.ok(manifest.includes('name: flow-map') && manifest.includes('staticfile_buildpack'));
  const html = readFileSync(join(site.out, 'index.html'), 'utf8');
  assert.ok(html.includes('./assets/') || html.includes('"./'), 'bundle must use a relative base');
});
