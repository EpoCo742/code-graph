import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Locate the built explorer (dist/) of @codegraph/ui. */
export function uiDistDir(): string {
  const pkg = require.resolve('@codegraph/ui/package.json');
  const dist = join(dirname(pkg), 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`Explorer UI is not built (${dist}). Run "npm run build -w @codegraph/ui" or install a published @codegraph/ui.`);
  }
  return dist;
}

export interface ServeOptions {
  graphPath: string;
  port?: number;
  host?: string;
  log?: (msg: string) => void;
}

/** Serve the explorer with the given graph.json at /graph.json. Resolves with the URL once listening. */
export function serve(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  const dist = uiDistDir();
  const graphPath = resolve(opts.graphPath);
  if (!existsSync(graphPath)) throw new Error(`graph not found: ${graphPath}`);
  const port = opts.port ?? 4173;
  const host = opts.host ?? '127.0.0.1';
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    let file: string;
    if (url === '/graph.json') file = graphPath;
    else {
      const rel = normalize(decodeURIComponent(url)).replace(/^([/\\])+/, '');
      file = join(dist, rel || 'index.html');
      if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://${host}:${boundPort}/`;
      opts.log?.(`explorer: ${url}  (graph: ${graphPath})`);
      resolvePromise({ url, close: () => server.close() });
    });
  });
}
