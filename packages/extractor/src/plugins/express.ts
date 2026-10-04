import path from 'node:path';
import type { HttpMethod } from '@codegraph/schema';
import type { Invocation, RepoFacts } from '../model.js';
import { resolveHandler } from './aspnetcore.js';
import type { Plugin } from './types.js';
import { HTTP_VERBS, joinPaths, methodFromWord } from './util.js';

const ROUTER_NAMES = /^(app|router|server|fastify|routes?|r|koa|express|hono|srv|v\d+)$/i;

function isRouteRegistration(inv: Invocation, repo?: RepoFacts, file?: string): boolean {
  if (!(inv.method in HTTP_VERBS)) return false;
  const first = inv.args[0];
  if (!first || (first.kind !== 'string' && first.kind !== 'template')) return false;
  if (!first.value.startsWith('/') && !first.value.startsWith('*')) return false;
  const rest = inv.args.slice(1);
  if (!rest.length) return false;
  const hasHandler = rest.some((a) => a.kind === 'function' || a.kind === 'ident' || a.kind === 'member');
  const receiver = inv.receiverChain[inv.receiverChain.length - 1] ?? '';
  if (repo && receiver) {
    // receiver created by axios.create / got.extend / ky.create is an HTTP client, not a router
    const creator = repo.variables.get(`${file}:${receiver}`) ?? repo.variables.get(receiver);
    if (creator && /^(create|extend)$/.test(creator.method)) return false;
  }
  const hasFunction = rest.some((a) => a.kind === 'function');
  return hasFunction || (hasHandler && ROUTER_NAMES.test(receiver));
}

function hasRouterFactory(repo: RepoFacts): boolean {
  return repo.units.some((u) =>
    u.invocations.some((i) => (!i.receiver && /^(express|fastify|Fastify|Router|polka|restify)$/.test(i.method)) || (i.receiver && /^(express|Hono|Koa)$/.test(i.receiver) && i.method === 'Router')),
  ) || [...repo.refs.values()].some((r) => /^new\s+(Koa|Hono|Router)/.test(r));
}

/** Resolve an import source like './routes/products' to a repo-relative file path. */
export function resolveImport(repo: RepoFacts, fromFile: string, source: string): string | undefined {
  if (!source.startsWith('.')) return undefined;
  const dir = path.posix.dirname(fromFile);
  const base = path.posix.normalize(path.posix.join(dir, source)).replace(/\.(js|mjs|cjs)$/, '');
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.ts`, `${base}/index.js`];
  const files = new Set(repo.files.map((f) => f.path));
  return candidates.find((c) => files.has(c));
}

function importedFile(repo: RepoFacts, fromFile: string, ident: string): string | undefined {
  const ff = repo.files.find((f) => f.path === fromFile);
  const imp = ff?.imports.find((i) => i.names.includes(ident));
  if (!imp) return undefined;
  return resolveImport(repo, fromFile, imp.source);
}

interface Mount {
  prefix: string;
  /** identifier of the mounted router */
  ident: string;
  /** file where the mount happens */
  file: string;
  /** receiver the router is mounted on (app / parent router) */
  onReceiver: string;
  /** file that defines the mounted router when imported */
  targetFile?: string;
}

export const express: Plugin = {
  name: 'express',
  detect(repo) {
    if (!repo.languages.has('typescript') && !repo.languages.has('javascript')) return false;
    const deps = [...repo.dependencies];
    if (deps.some((d) => /^(express|koa|@koa\/router|koa-router|fastify|hapi|@hapi\/hapi|restify|polka|hono)$/.test(d))) return true;
    if (deps.some((d) => d.startsWith('@nestjs/'))) return false;
    return hasRouterFactory(repo) && repo.units.some((u) => u.invocations.some((i) => isRouteRegistration(i, repo, u.file)));
  },
  apply(ctx) {
    const { repo } = ctx;
    const mounts: Mount[] = [];
    for (const unit of repo.units) {
      for (const inv of unit.invocations) {
        if (inv.method !== 'use' && inv.method !== 'register') continue;
        const onReceiver = inv.receiverChain[inv.receiverChain.length - 1] ?? '';
        const a0 = inv.args[0];
        const a1 = inv.args[1];
        if (a0?.kind === 'ident' && a1?.kind === 'object' && a1.props?.prefix) {
          mounts.push({ prefix: a1.props.prefix, ident: a0.value, file: unit.file, onReceiver, targetFile: importedFile(repo, unit.file, a0.value) });
          continue;
        }
        if (!a0 || (a0.kind !== 'string' && a0.kind !== 'template') || !a1) continue;
        for (const id of inv.args.slice(1)) {
          if (id.kind !== 'ident' && id.kind !== 'member' && id.kind !== 'other') continue;
          const name = id.value.replace(/\(.*$/, '').split('.')[0];
          if (!name) continue;
          mounts.push({ prefix: a0.value, ident: name, file: unit.file, onReceiver, targetFile: importedFile(repo, unit.file, name) });
        }
      }
    }

    const prefixFor = (file: string, receiver: string): string => {
      const parts: string[] = [];
      let curFile = file;
      let curIdent = receiver;
      for (let depth = 0; depth < 5; depth++) {
        const m = mounts.find((x) => x.file === curFile && x.ident === curIdent) ?? mounts.find((x) => x.targetFile === curFile && x.ident === curIdent) ?? mounts.find((x) => x.targetFile === curFile);
        if (!m) break;
        parts.unshift(m.prefix);
        if (m.file === curFile && m.onReceiver === curIdent) break;
        curFile = m.file;
        curIdent = m.onReceiver;
      }
      return parts.join('');
    };

    for (const unit of repo.units) {
      for (const inv of unit.invocations) {
        const receiver = inv.receiverChain[inv.receiverChain.length - 1] ?? '';
        if (inv.method === 'route' && inv.args[0]?.kind === 'object') {
          const p = inv.args[0].props ?? {};
          const url = p.url ?? p.path;
          if (!url) continue;
          const method = (methodFromWord(p.method ?? 'ANY') ?? 'ANY') as HttpMethod;
          const handler = resolveHandler(ctx, unit, [{ kind: 'ident', value: p.handler ?? '' }]);
          ctx.addEndpoint({ method, path: joinPaths(prefixFor(unit.file, receiver), url), handler, location: ctx.loc(unit, inv.line) });
          continue;
        }
        if (!isRouteRegistration(inv, repo, unit.file)) continue;
        const method = HTTP_VERBS[inv.method];
        const handler = resolveHandler(ctx, unit, inv.args.slice(1).filter((a) => a.kind !== 'object'));
        ctx.addEndpoint({ method, path: joinPaths(prefixFor(unit.file, receiver), inv.args[0].value), handler, location: ctx.loc(unit, inv.line) });
      }
    }
  },
};
