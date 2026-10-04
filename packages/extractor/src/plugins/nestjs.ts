import type { HttpMethod } from '@codegraph/schema';
import type { Plugin } from './types.js';
import { joinPaths } from './util.js';

const NEST_VERBS: Record<string, HttpMethod> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Head: 'HEAD',
  Options: 'OPTIONS',
  All: 'ANY',
};

export const nestjs: Plugin = {
  name: 'nestjs',
  detect(repo) {
    if (!repo.languages.has('typescript') && !repo.languages.has('javascript')) return false;
    return [...repo.dependencies].some((d) => d.startsWith('@nestjs/')) || [...repo.types.values()].some((t) => t.attrs.some((a) => a.name === 'Controller'));
  },
  apply(ctx) {
    const { repo } = ctx;
    let globalPrefix = '';
    for (const u of repo.units) {
      const gp = u.invocations.find((i) => i.method === 'setGlobalPrefix');
      const v = gp?.args[0];
      if (v && (v.kind === 'string' || v.kind === 'template')) globalPrefix = v.value;
    }
    for (const type of repo.types.values()) {
      const ctrl = type.attrs.find((a) => a.name === 'Controller');
      if (!ctrl) continue;
      const prefixes = ctrl.args.length ? ctrl.args[0].split(',').map((s) => s.trim()) : ctrl.named.path ? [ctrl.named.path] : [''];
      for (const uid of type.methods) {
        const unit = repo.unitById.get(uid);
        if (!unit) continue;
        for (const a of unit.attrs) {
          const method = NEST_VERBS[a.name];
          if (!method) continue;
          const paths = a.args.length ? a.args[0].split(',').map((s) => s.trim()) : [''];
          for (const prefix of prefixes) {
            for (const p of paths) {
              ctx.addEndpoint({
                method,
                path: joinPaths(joinPaths(globalPrefix, prefix), p),
                handler: unit.id,
                location: ctx.loc(unit),
                operationId: `${type.name.replace(/Controller$/, '')}.${unit.name.split('.').pop()}`,
              });
            }
          }
        }
      }
    }
  },
};
