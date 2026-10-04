import type { HttpMethod } from '@codegraph/schema';
import type { ArgValue, CodeUnit, Param, RepoFacts, TypeFacts } from '../model.js';

export const HTTP_VERBS: Record<string, HttpMethod> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  del: 'DELETE',
  head: 'HEAD',
  options: 'OPTIONS',
  all: 'ANY',
  any: 'ANY',
};

export function methodFromWord(word: string): HttpMethod | undefined {
  const w = word.toLowerCase();
  if (HTTP_VERBS[w]) return HTTP_VERBS[w];
  const m = /^(get|post|put|patch|delete|head|options)/.exec(w);
  if (m) return HTTP_VERBS[m[1]];
  const e = /(get|post|put|patch|delete|head|options)$/.exec(w);
  if (e) return HTTP_VERBS[e[1]];
  return undefined;
}

/** Normalise an HTTP route path: leading slash, {param} style, no trailing slash. */
export function normalizePath(p: string): string {
  let s = p.trim();
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  s = s.split('?')[0];
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/{2,}/g, '/');
  // :id -> {id}; {id:int} -> {id}; {id?} -> {id}; {**rest} -> {rest}; <id> flask style
  s = s.replace(/:([A-Za-z_][\w]*)(\([^)]*\))?/g, '{$1}');
  s = s.replace(/\{\*{1,2}([^}:?]+)[^}]*\}/g, '{$1}');
  s = s.replace(/\{([^}:?]+)[^}]*\}/g, '{$1}');
  s = s.replace(/<(?:[a-z]+:)?([^>]+)>/g, '{$1}');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

export function joinPaths(prefix: string | undefined, p: string | undefined): string {
  const a = prefix ? prefix.trim() : '';
  const b = p ? p.trim() : '';
  if (b.startsWith('/') && a === '') return normalizePath(b);
  return normalizePath(`${a}/${b}`);
}

export function splitList(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export function argString(a: ArgValue | undefined): string | undefined {
  if (!a) return undefined;
  if (a.kind === 'string' || a.kind === 'template') return a.value;
  return undefined;
}

export function stripGenerics(t: string | undefined): string | undefined {
  if (!t) return undefined;
  return t.replace(/<.*>$/, '').replace(/\?$/, '').replace(/\[\]$/, '').trim();
}

export function normIdent(s: string): string {
  return s.replace(/^_+/, '').toLowerCase();
}

export function findMember(type: TypeFacts | undefined, name: string): Param | undefined {
  if (!type) return undefined;
  const n = normIdent(name);
  return [...type.fields, ...type.ctorParams].find((f) => normIdent(f.name) === n);
}

/** Resolve the declared type of a receiver identifier within a unit's enclosing type (or params). */
export function receiverType(repo: RepoFacts, unit: CodeUnit, receiver: string): string | undefined {
  const fromParam = unit.params.find((p) => normIdent(p.name) === normIdent(receiver))?.type;
  if (fromParam) return stripGenerics(fromParam);
  const t = unit.typeName ? repo.types.get(unit.typeName) : undefined;
  const member = findMember(t, receiver);
  return stripGenerics(member?.type);
}

export function hostOf(url: string): string | undefined {
  const m = /^(?:https?|wss?):\/\/([^/:?#{}]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : undefined;
}

export function isUrlLike(s: string): boolean {
  return /^(https?:\/\/|\/|\{)/.test(s.trim()) || /\{[^}]+\}\//.test(s);
}

export function slug(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Extract a config key / env var reference from an expression string. */
export function configKeyFromExpr(expr: string): string | undefined {
  const t = expr.trim();
  let m = /process\.env\.([A-Za-z_][\w]*)/.exec(t);
  if (m) return m[1];
  m = /import\.meta\.env\.([A-Za-z_][\w]*)/.exec(t);
  if (m) return m[1];
  m = /GetEnvironmentVariable\(\s*["']([^"']+)["']/.exec(t);
  if (m) return m[1];
  m = /System\.getenv\(\s*["']([^"']+)["']/.exec(t);
  if (m) return m[1];
  m = /\[\s*["']([^"']+)["']\s*\]/.exec(t);
  if (m) return m[1];
  m = /\.(?:GetValue|GetSection|getProperty|GetConnectionString)(?:<[^>]+>)?\(\s*["']([^"']+)["']/.exec(t);
  if (m) return m[1];
  m = /\$\{([^}:]+)(?::[^}]*)?\}/.exec(t);
  if (m) return m[1];
  return undefined;
}
