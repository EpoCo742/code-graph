import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { uiDistDir } from './serve.js';

export interface PackageOptions {
  graphPath: string;
  out: string;
  /** Cloud Foundry app name written into manifest.yml. Default: codegraph-explorer. */
  appName?: string;
  /** Optional docs directory to ship under /docs for download. */
  docsDir?: string;
  /** Optional htpasswd content; when given, Staticfile.auth is written and basic auth is enforced. */
  htpasswd?: string;
  /** Memory for the CF app. Default 64M (nginx serving static files). */
  memory?: string;
  log?: (msg: string) => void;
}

/**
 * Assemble a self-contained static site: the explorer bundle + graph.json
 * (+ docs), plus a Cloud Foundry `manifest.yml` and `Staticfile` so the folder
 * can be deployed with `cf push` using the staticfile buildpack. The same folder
 * also works on any static host (S3, nginx, GitHub Pages).
 */
export function packageSite(opts: PackageOptions): { out: string; files: string[] } {
  const out = resolve(opts.out);
  const graphPath = resolve(opts.graphPath);
  if (!existsSync(graphPath)) throw new Error(`graph not found: ${graphPath}`);
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  if (graph?.schemaVersion !== '1') throw new Error(`${graphPath} is not a codegraph graph.json`);
  const dist = uiDistDir();
  const appName = opts.appName ?? 'codegraph-explorer';

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(dist, out, { recursive: true });
  rmSync(join(out, '.gitkeep'), { force: true }); // placeholder from the UI's public folder
  cpSync(graphPath, join(out, 'graph.json'));
  if (opts.docsDir && existsSync(opts.docsDir)) cpSync(opts.docsDir, join(out, 'docs'), { recursive: true });

  // Staticfile buildpack configuration (https://docs.cloudfoundry.org/buildpacks/staticfile/)
  const staticfile = [
    'root: .',
    'force_https: enabled',
    'location_include: includes/*.conf',
    'directory: hidden',
  ].join('\n');
  writeFileSync(join(out, 'Staticfile'), staticfile + '\n');
  mkdirSync(join(out, 'nginx', 'conf', 'includes'), { recursive: true });
  writeFileSync(
    join(out, 'nginx', 'conf', 'includes', 'codegraph.conf'),
    [
      '# graph.json changes on every deploy; never let browsers cache it.',
      'location = /graph.json {',
      '  add_header Cache-Control "no-store";',
      '  types { application/json json; }',
      '}',
      '# Hashed assets are immutable.',
      'location /assets/ {',
      '  add_header Cache-Control "public, max-age=31536000, immutable";',
      '}',
      '',
    ].join('\n'),
  );
  if (opts.htpasswd) writeFileSync(join(out, 'Staticfile.auth'), opts.htpasswd.trim() + '\n');

  const manifest = [
    '---',
    'applications:',
    `  - name: ${appName}`,
    `    memory: ${opts.memory ?? '64M'}`,
    '    instances: 1',
    '    buildpacks:',
    '      - staticfile_buildpack',
    '    path: .',
    '    env:',
    `      CODEGRAPH_GENERATED_AT: "${graph.generatedAt ?? ''}"`,
    '',
  ].join('\n');
  writeFileSync(join(out, 'manifest.yml'), manifest);
  writeFileSync(join(out, '.cfignore'), 'README.md\n');

  const files = ['index.html', 'graph.json', 'manifest.yml', 'Staticfile', 'nginx/conf/includes/codegraph.conf', ...(opts.htpasswd ? ['Staticfile.auth'] : []), ...(opts.docsDir ? ['docs/'] : [])];
  opts.log?.(`site packaged at ${out} (${basename(dist)} bundle + graph.json${opts.docsDir ? ' + docs' : ''}); deploy with: cf push -f ${join(out, 'manifest.yml')}`);
  return { out, files };
}
