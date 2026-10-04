/** URL / path helpers shared by resolution and flow derivation. */

/** Normalise a route path: leading slash, collapse slashes, params as {p}, no trailing slash. */
export function normalisePath(p: string): string {
  let s = p.trim();
  s = s.replace(/\{[^}]*\}/g, '{p}'); // {id}, {expr}, {id:int}
  s = s.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{p}'); // :id
  s = s.replace(/\*+/g, '{p}');
  s = s.replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export interface ParsedUrl {
  /** Host without port, lowercase, when the URL is absolute. */
  host?: string;
  /** Path portion with interpolations normalised. May be empty. */
  path: string;
  /** True when the URL started with an interpolation like {baseUrl}. */
  dynamicPrefix: boolean;
}

/** Parse a call URL as written in code ("{base}/orders/{id}", "https://x.com/a", "/a/b"). */
export function parseCallUrl(url: string): ParsedUrl {
  let u = url.trim();
  const dynamicPrefix = /^\{[^}]*\}/.test(u);
  if (dynamicPrefix) u = u.replace(/^\{[^}]*\}/, '');
  const abs = /^https?:\/\//i.exec(u);
  let host: string | undefined;
  if (abs) {
    u = u.slice(abs[0].length);
    const slash = u.indexOf('/');
    const hostPart = slash === -1 ? u : u.slice(0, slash);
    u = slash === -1 ? '' : u.slice(slash);
    host = hostPart.replace(/:\d+$/, '').toLowerCase();
    if (/[{}]/.test(host)) host = undefined; // host itself is dynamic
  }
  const q = u.indexOf('?');
  if (q !== -1) u = u.slice(0, q);
  const path = u ? normalisePath(u) : '';
  return { host, path, dynamicPrefix };
}

/** Does a concrete-ish call path match an endpoint pattern? Both normalised. Suffix matching allowed. */
export function pathMatches(callPath: string, endpointPath: string): boolean {
  const c = callPath.split('/').filter(Boolean);
  const e = endpointPath.split('/').filter(Boolean);
  if (c.length === 0 || e.length === 0) return false;
  // Allow the call to omit a leading prefix (e.g. base URL includes "/api")
  for (let offset = 0; offset <= e.length - c.length; offset++) {
    let ok = true;
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = e[offset + i];
      if (a === '{p}' || b === '{p}') continue;
      if (a.toLowerCase() !== b.toLowerCase()) { ok = false; break; }
    }
    if (ok && offset + c.length === e.length) return true;
  }
  return false;
}

/** Score how specific a match is: number of literal segments that matched. */
export function matchScore(callPath: string, endpointPath: string): number {
  const c = callPath.split('/').filter(Boolean);
  const e = endpointPath.split('/').filter(Boolean);
  let score = 0;
  const offset = e.length - c.length;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = e[offset + i];
    if (a !== '{p}' && b !== '{p}' && a.toLowerCase() === b.toLowerCase()) score++;
  }
  return score;
}

/** Tokenise an identifier/hint/service id into lowercase words for fuzzy matching. */
export function tokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !GENERIC.has(t));
}

const GENERIC = new Set(['api', 'service', 'services', 'svc', 'client', 'url', 'baseurl', 'base', 'http', 'https', 'host', 'uri', 'endpoint', 'address', 'vite', 'env', 'app', 'config', 'v1', 'v2']);
