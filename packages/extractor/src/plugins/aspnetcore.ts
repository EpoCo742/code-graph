import type { HttpMethod } from '@codegraph/schema';
import type { CodeUnit } from '../model.js';
import type { Plugin, PluginContext } from './types.js';
import { argString, joinPaths, methodFromWord, normalizePath } from './util.js';

const HTTP_ATTRS: Record<string, HttpMethod> = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpPatch: 'PATCH',
  HttpDelete: 'DELETE',
  HttpHead: 'HEAD',
  HttpOptions: 'OPTIONS',
};

const MAP_METHODS: Record<string, HttpMethod> = {
  MapGet: 'GET',
  MapPost: 'POST',
  MapPut: 'PUT',
  MapPatch: 'PATCH',
  MapDelete: 'DELETE',
  MapMethods: 'ANY',
  Map: 'ANY',
  MapFallback: 'ANY',
};

function substituteTokens(route: string, typeName: string | undefined, action: string): string {
  const controller = (typeName ?? '').replace(/Controller$/, '');
  return route.replace(/\[controller\]/gi, controller).replace(/\[action\]/gi, action).replace(/\[area\]/gi, 'area');
}

export const aspnetcore: Plugin = {
  name: 'aspnetcore',
  detect(repo) {
    if (!repo.languages.has('csharp')) return false;
    return (
      [...repo.dependencies].some((d) => /AspNetCore|Microsoft\.NET\.Sdk\.Web/.test(d)) ||
      repo.units.some((u) => u.attrs.some((a) => a.name in HTTP_ATTRS || a.name === 'Route')) ||
      repo.units.some((u) => u.invocations.some((i) => i.method in MAP_METHODS))
    );
  },
  apply(ctx) {
    const { repo } = ctx;
    // Attribute-routed controllers
    for (const type of repo.types.values()) {
      if (type.isInterface) continue;
      const isController =
        /Controller$/.test(type.name) || type.attrs.some((a) => a.name === 'ApiController' || a.name === 'Route') || type.baseTypes.some((b) => /Controller/.test(b));
      if (!isController) continue;
      const classRoutes = type.attrs.filter((a) => a.name === 'Route').map((a) => a.args[0] ?? a.named.template ?? '');
      const prefixes = classRoutes.length ? classRoutes : [''];
      for (const uid of type.methods) {
        const unit = repo.unitById.get(uid);
        if (!unit) continue;
        const action = unit.name.split('.').pop() ?? '';
        const verbs = unit.attrs.filter((a) => a.name in HTTP_ATTRS);
        const routeAttrs = unit.attrs.filter((a) => a.name === 'Route').map((a) => a.args[0] ?? '');
        if (!verbs.length && !routeAttrs.length) continue;
        const methodVerbs: [HttpMethod, string | undefined][] = verbs.length
          ? verbs.map((v) => [HTTP_ATTRS[v.name], v.args[0] ?? v.named.template] as [HttpMethod, string | undefined])
          : [['ANY', undefined]];
        for (const [method, templ] of methodVerbs) {
          const templates = templ !== undefined ? [templ] : routeAttrs.length ? routeAttrs : [''];
          for (const t of templates) {
            for (const prefix of prefixes) {
              const path = t.startsWith('/') || t.startsWith('~/') ? normalizePath(t.replace(/^~/, '')) : joinPaths(prefix, t);
              ctx.addEndpoint({
                method,
                path: substituteTokens(path, type.name, action),
                handler: unit.id,
                location: ctx.loc(unit),
                operationId: `${type.name.replace(/Controller$/, '')}.${action}`,
              });
            }
          }
        }
      }
    }

    // Minimal APIs
    const groupPrefixes = new Map<string, string>();
    for (const [name, inv] of repo.variables) {
      if (inv.method === 'MapGroup') {
        const p = argString(inv.args[0]);
        if (p) {
          const parent = inv.receiver ? groupPrefixes.get(inv.receiver) : undefined;
          groupPrefixes.set(name.includes(':') ? name.split(':').pop()! : name, joinPaths(parent, p));
        }
      }
    }
    for (const unit of repo.units) {
      for (const inv of unit.invocations) {
        const verb = MAP_METHODS[inv.method];
        if (!verb) continue;
        let pathArg = inv.args[0];
        let method: HttpMethod = verb;
        if (inv.method === 'MapMethods') {
          const methods = inv.args[1];
          const first = methods?.items?.[0] ?? methods?.value;
          method = methodFromWord(first ?? '') ?? 'ANY';
        }
        const p = ctx.resolveString(pathArg, unit);
        if (!p) {
          ctx.issue('warn', 'dynamic-route', `${unit.name}: ${inv.method} with non-literal path`, ctx.loc(unit, inv.line));
          continue;
        }
        const receiver = inv.receiverChain[inv.receiverChain.length - 1] ?? '';
        const prefix = groupPrefixes.get(receiver);
        const handler = resolveHandler(ctx, unit, inv.args.slice(1));
        ctx.addEndpoint({ method, path: joinPaths(prefix, p.value), handler, location: ctx.loc(unit, inv.line) });
      }
    }
  },
};

export function resolveHandler(ctx: PluginContext, unit: CodeUnit, args: { kind: string; value: string }[]): string {
  const { repo } = ctx;
  for (const a of args) {
    if (a.kind === 'function' && repo.unitById.has(a.value)) return a.value;
    if (a.kind === 'ident') {
      const sameFile = repo.units.find((u) => u.file === unit.file && (u.name === a.value || u.id.endsWith(`.${a.value}`)));
      if (sameFile) return sameFile.id;
      const any = repo.units.filter((u) => u.name === a.value || u.name.endsWith(`.${a.value}`));
      if (any.length === 1) return any[0].id;
    }
    if (a.kind === 'member') {
      const [recv, m] = a.value.split('.').slice(-2);
      const typeName = recv.charAt(0).toUpperCase() + recv.slice(1);
      const cands = repo.units.filter((u) => u.name.endsWith(`.${m}`) && (u.typeName === typeName || u.typeName === recv || u.typeName?.toLowerCase() === typeName.toLowerCase()));
      if (cands.length === 1) return cands[0].id;
      const loose = repo.units.filter((u) => u.name.endsWith(`.${m}`));
      if (loose.length === 1) return loose[0].id;
    }
  }
  // fall back to the registering unit
  return unit.id;
}
