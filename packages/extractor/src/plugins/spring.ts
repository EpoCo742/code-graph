import type { HttpMethod } from '@codegraph/schema';
import type { Attr } from '../model.js';
import type { Plugin } from './types.js';
import { hostOf, joinPaths, splitList } from './util.js';

const MAPPING_ATTRS: Record<string, HttpMethod> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  PatchMapping: 'PATCH',
  DeleteMapping: 'DELETE',
  RequestMapping: 'ANY',
  // Jakarta / JAX-RS
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS',
};

function pathsOf(a: Attr): string[] {
  const raw = a.args[0] ?? a.named.value ?? a.named.path;
  const list = splitList(raw);
  return list.length ? list : [''];
}

function methodsOf(a: Attr): HttpMethod[] {
  if (a.name !== 'RequestMapping') return [MAPPING_ATTRS[a.name]];
  const m = a.named.method;
  if (!m) return ['ANY'];
  return splitList(m).map((x) => (x.split('.').pop() ?? 'ANY').toUpperCase() as HttpMethod);
}

export const spring: Plugin = {
  name: 'spring',
  detect(repo) {
    if (!repo.languages.has('java')) return false;
    return repo.units.some((u) => u.attrs.some((a) => a.name in MAPPING_ATTRS)) || repo.types.size > 0;
  },
  apply(ctx) {
    const { repo } = ctx;
    for (const type of repo.types.values()) {
      const isFeign = type.attrs.some((a) => a.name === 'FeignClient' || a.name === 'HttpExchange');
      const classMappings = type.attrs.filter((a) => a.name === 'RequestMapping' || a.name === 'Path' || a.name === 'HttpExchange');
      const prefixes = classMappings.length ? classMappings.flatMap(pathsOf) : [''];
      if (isFeign) {
        ctx.clientUnits.add(type.name);
        const feign = type.attrs.find((a) => a.name === 'FeignClient' || a.name === 'HttpExchange')!;
        const name = feign.named.name ?? feign.named.value ?? feign.args[0];
        const url = feign.named.url ?? (feign.name === 'HttpExchange' ? feign.args[0] : undefined);
        for (const uid of type.methods) {
          const unit = repo.unitById.get(uid);
          if (!unit) continue;
          for (const a of unit.attrs.filter((x) => x.name in MAPPING_ATTRS || /Exchange$/.test(x.name))) {
            const methods = /Exchange$/.test(a.name) ? [(a.name.replace(/Exchange$/, '').toUpperCase() || 'ANY') as HttpMethod] : methodsOf(a);
            for (const p of pathsOf(a)) {
              for (const prefix of prefixes) {
                const path = joinPaths(prefix, p);
                const absolute = url && /^https?:\/\//.test(url) ? url.replace(/\/$/, '') + path : path;
                const hint = url && hostOf(url) ? hostOf(url) : url && url.startsWith('${') ? url.replace(/^\$\{|\}$/g, '').split(':')[0] : name;
                for (const method of methods) {
                  ctx.addCall({
                    method,
                    url: absolute,
                    targetHint: hint,
                    targetService: ctx.targetFor(hint) ?? ctx.targetFor(name),
                    fromHandler: unit.id,
                    location: ctx.loc(unit),
                  });
                }
              }
            }
          }
        }
        continue;
      }
      const isController = type.attrs.some((a) => a.name === 'RestController' || a.name === 'Controller' || a.name === 'Path');
      if (!isController && !type.methods.some((m) => repo.unitById.get(m)?.attrs.some((a) => a.name in MAPPING_ATTRS))) continue;
      for (const uid of type.methods) {
        const unit = repo.unitById.get(uid);
        if (!unit) continue;
        for (const a of unit.attrs.filter((x) => x.name in MAPPING_ATTRS)) {
          // JAX-RS: @GET + @Path("..") on method
          const jaxPath = unit.attrs.find((x) => x.name === 'Path');
          const paths = a.name.toUpperCase() === a.name && jaxPath ? pathsOf(jaxPath) : pathsOf(a);
          for (const method of methodsOf(a)) {
            for (const p of paths) {
              for (const prefix of prefixes) {
                ctx.addEndpoint({
                  method,
                  path: joinPaths(prefix, p),
                  handler: unit.id,
                  location: ctx.loc(unit),
                  operationId: `${type.name.replace(/Controller$/, '')}.${unit.name.split('.').pop()}`,
                });
              }
            }
          }
        }
      }
    }
  },
};
