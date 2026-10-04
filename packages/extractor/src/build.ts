import { createHash } from 'node:crypto';
import type {
  ExtractionIssue,
  ExtractorConfig,
  Handler,
  HandlerKind,
  HttpCall,
  HttpEndpoint,
  MessageConsumer,
  MessagePublish,
  ServiceInfo,
  ServiceManifest,
  SourceLocation,
} from '@codegraph/schema';
import { MANIFEST_SCHEMA_VERSION } from '@codegraph/schema';
import type { ArgValue, CodeUnit, RepoFacts } from './model.js';
import type { PluginContext, SyntheticHandler } from './plugins/types.js';
import { ALL_PLUGINS } from './plugins/index.js';
import { configKeyFromExpr, hostOf } from './plugins/util.js';
import { buildCallGraph } from './callgraph.js';

export const GENERATOR = { name: '@codegraph/extractor', version: '0.1.0' };

function hash(body: string): string {
  return createHash('sha256').update(body.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

function unique<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  for (const it of items) {
    const n = seen.get(it.id) ?? 0;
    seen.set(it.id, n + 1);
    if (n > 0) it.id = `${it.id}#${n + 1}`;
  }
  return items;
}

export function createContext(repo: RepoFacts, config: ExtractorConfig, issues: ExtractionIssue[]): PluginContext {
  const targets = config.targets ?? {};
  const targetLookup = new Map<string, string>();
  for (const [k, v] of Object.entries(targets)) targetLookup.set(k.toLowerCase(), v);

  const loc = (unit: CodeUnit, line?: number): SourceLocation => ({ file: unit.file, line: line ?? unit.line });

  const resolveName = (name: string, unit: CodeUnit): string | undefined => {
    const clean = name.replace(/^this\./, '').replace(/^_+/, '');
    const parts = clean.split('.');
    const last = parts[parts.length - 1];
    const candidates = [
      clean,
      name,
      `${unit.typeName}.${last}`,
      parts.length >= 2 ? `${parts[parts.length - 2]}.${last}` : '',
      last,
    ].filter(Boolean);
    for (const c of candidates) {
      const v = repo.constants.get(c);
      if (v !== undefined) return v;
    }
    const t = unit.typeName ? repo.types.get(unit.typeName) : undefined;
    if (t && t.constants[last] !== undefined) return t.constants[last];
    return undefined;
  };

  const ctx: PluginContext = {
    repo,
    config,
    endpoints: [],
    consumers: [],
    calls: [],
    publishes: [],
    issues,
    syntheticHandlers: [],
    clientUnits: new Set(),
    addEndpoint(e) {
      ctx.endpoints.push({ id: `${e.method} ${e.path}`, ...e });
    },
    addConsumer(c) {
      ctx.consumers.push({ id: `${c.broker}:${c.topic}`, ...c });
    },
    addCall(c) {
      ctx.calls.push({ id: `${c.method ?? 'ANY'} ${c.url} <- ${c.fromHandler}`, ...c });
    },
    addPublish(p) {
      ctx.publishes.push({ id: `${p.broker}:${p.topic} <- ${p.fromHandler}`, ...p });
    },
    issue(level, code, message, location) {
      issues.push({ level, code, message, location });
    },
    resolveString(arg, unit) {
      if (!arg) return undefined;
      if (arg.kind === 'string' || arg.kind === 'template') return { value: arg.value, resolved: true };
      if (arg.kind === 'ident' || arg.kind === 'member') {
        const v = resolveName(arg.value, unit);
        if (v !== undefined) return { value: v, resolved: true };
        const ref = repo.refs.get(`${unit.file}:${arg.value}`) ?? repo.refs.get(arg.value);
        if (ref) {
          const key = configKeyFromExpr(ref);
          if (key) return { value: key, resolved: false };
        }
        const last = arg.value.split('.').pop()!;
        return { value: last, resolved: false };
      }
      return undefined;
    },
    hintFor(arg, unit) {
      if (!arg) return undefined;
      const fromExpr = (expr: string): string | undefined => {
        const key = configKeyFromExpr(expr);
        if (key) return key;
        const host = hostOf(expr.replace(/^["'`]|["'`]$/g, ''));
        if (host) return host;
        const name = expr
          .trim()
          .replace(/^this\./, '')
          .replace(/^\(?await\s+/, '')
          .replace(/\(\)$/, '');
        if (!/^[A-Za-z_$][\w$.]*$/.test(name)) return undefined;
        const last = name.split('.').pop()!.replace(/^_+/, '');
        // module-level reference, e.g. const BASE = process.env.X
        const ref = repo.refs.get(`${unit.file}:${name}`) ?? repo.refs.get(name) ?? repo.refs.get(last);
        if (ref) {
          const k = configKeyFromExpr(ref) ?? hostOf(ref.replace(/^["'`]|["'`]$/g, ''));
          if (k) return k;
        }
        // module constant holding an absolute URL
        const c = resolveName(name, unit);
        if (c) {
          const h = hostOf(c);
          if (h) return h;
        }
        // field annotated with @Value("${key}")
        const t = unit.typeName ? repo.types.get(unit.typeName) : undefined;
        const member = t ? [...t.fields, ...t.ctorParams].find((f) => f.name.replace(/^_+/, '').toLowerCase() === last.toLowerCase()) : undefined;
        const valueAttr = member?.attrs?.find((a) => /^(Value|ConfigProperty|Named|Inject)$/.test(a.name));
        if (valueAttr?.args[0]) return configKeyFromExpr(valueAttr.args[0]) ?? valueAttr.args[0];
        // assignment somewhere in the type: _baseUrl = config["X"];
        if (t) {
          for (const uid of t.methods) {
            const u = repo.unitById.get(uid);
            if (!u) continue;
            const m = new RegExp(`(?:this\\.)?_?${last}\\s*=\\s*([^;\\n]+)`).exec(u.body);
            if (m) {
              const k = configKeyFromExpr(m[1]) ?? hostOf(m[1].replace(/^["'`]|["'`]$/g, ''));
              if (k) return k;
            }
          }
        }
        // options pattern: _options.Value.InventoryUrl -> InventoryUrl ; settings.inventoryUrl
        if (member?.type && /Options|Settings|Config/.test(member.type)) return undefined;
        return last;
      };
      if (arg.kind === 'string') return hostOf(arg.value);
      if (arg.kind === 'template') {
        const host = hostOf(arg.value);
        if (host && !host.includes('{')) return host;
        for (const i of arg.interpolations ?? []) {
          const h = fromExpr(i);
          if (h) return h;
        }
        return undefined;
      }
      if (arg.kind === 'ident' || arg.kind === 'member') return fromExpr(arg.value);
      return undefined;
    },
    targetFor(hint) {
      if (!hint) return undefined;
      const direct = targetLookup.get(hint.toLowerCase());
      if (direct) return direct;
      // allow matching on the last segment of a config key (Services:Orders:BaseUrl -> Orders) is too loose; only exact.
      return undefined;
    },
    loc,
  };
  return ctx;
}

export function runPlugins(ctx: PluginContext, verbose = false): string[] {
  const enable = new Set(ctx.config.plugins?.enable ?? []);
  const disable = new Set(ctx.config.plugins?.disable ?? []);
  const ran: string[] = [];
  for (const p of ALL_PLUGINS) {
    if (disable.has(p.name)) continue;
    if (!enable.has(p.name) && !p.detect(ctx.repo)) continue;
    try {
      p.apply(ctx);
      ran.push(p.name);
    } catch (e) {
      ctx.issue('error', 'plugin-failed', `${p.name}: ${(e as Error).stack ?? e}`);
    }
  }
  if (verbose) console.error(`plugins: ${ran.join(', ') || '(none)'}`);
  return ran;
}

export function assembleManifest(ctx: PluginContext, service: ServiceInfo, opts: { commit?: string; prune?: boolean } = {}): ServiceManifest {
  const { repo } = ctx;
  const callGraph = buildCallGraph(repo);

  const endpoints = unique(ctx.endpoints);
  const consumers = unique(ctx.consumers);
  const calls = unique(ctx.calls);
  const publishes = unique(ctx.publishes);

  const entryIds = new Set<string>([...endpoints.map((e) => e.handler), ...consumers.map((c) => c.handler)]);
  const effectIds = new Set<string>([...calls.map((c) => c.fromHandler), ...publishes.map((p) => p.fromHandler)]);

  // Forward reachability from entries, backward from effects.
  const forward = reach(callGraph, entryIds, false);
  const backward = reach(callGraph, effectIds, true);
  const keep = new Set<string>([...entryIds, ...effectIds]);
  for (const id of forward) if (backward.has(id)) keep.add(id);
  // keep endpoint->effect paths through anonymous/module units
  for (const id of entryIds) keep.add(id);

  const prune = opts.prune ?? true;
  const handlers: Handler[] = [];
  const synthetic = new Map(ctx.syntheticHandlers.map((s) => [s.id, s] as [string, SyntheticHandler]));
  for (const unit of repo.units) {
    if (prune && !keep.has(unit.id)) continue;
    const kind = kindOf(unit, endpoints, consumers, ctx);
    const callees = [...(callGraph.get(unit.id) ?? [])].filter((c) => !prune || keep.has(c));
    handlers.push({
      id: unit.id,
      kind,
      name: unit.name,
      location: { file: unit.file, line: unit.line },
      calls: callees.sort(),
      hash: hash(unit.body),
    });
  }
  for (const s of synthetic.values()) {
    handlers.push({ id: s.id, kind: s.kind, name: s.name, location: s.location, calls: [] });
  }
  handlers.sort((a, b) => a.id.localeCompare(b.id));

  const knownHandlers = new Set(handlers.map((h) => h.id));
  const fix = <T extends { handler?: string; fromHandler?: string }>(items: T[], key: 'handler' | 'fromHandler') =>
    items.filter((i) => {
      const h = i[key] as string;
      if (knownHandlers.has(h)) return true;
      ctx.issue('warn', 'dangling-handler', `${key} ${h} not found; item dropped`);
      return false;
    });

  const manifest: ServiceManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    service,
    generatedAt: new Date().toISOString(),
    commit: opts.commit,
    generator: GENERATOR,
    endpoints: fix(endpoints, 'handler').sort(byId) as HttpEndpoint[],
    consumers: fix(consumers, 'handler').sort(byId) as MessageConsumer[],
    calls: fix(calls, 'fromHandler').sort(byId) as HttpCall[],
    publishes: fix(publishes, 'fromHandler').sort(byId) as MessagePublish[],
    handlers,
    declaredDependencies: ctx.config.declaredDependencies,
    issues: ctx.issues.length ? ctx.issues : undefined,
  };
  return manifest;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

function reach(graph: Map<string, Set<string>>, start: Set<string>, reverse: boolean): Set<string> {
  const adj = new Map<string, Set<string>>();
  if (reverse) {
    for (const [from, tos] of graph) {
      for (const to of tos) {
        if (!adj.has(to)) adj.set(to, new Set());
        adj.get(to)!.add(from);
      }
    }
  }
  const g = reverse ? adj : graph;
  const seen = new Set<string>(start);
  const stack = [...start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of g.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

function kindOf(unit: CodeUnit, endpoints: HttpEndpoint[], consumers: MessageConsumer[], ctx: PluginContext): HandlerKind {
  if (endpoints.some((e) => e.handler === unit.id)) return 'http';
  if (consumers.some((c) => c.handler === unit.id)) return 'message';
  if (unit.typeName && ctx.clientUnits.has(unit.typeName)) return 'client';
  if (!unit.typeName && !unit.isModule && !unit.isAnonymous && /(client|gateway|api|sdk)s?\.[jt]sx?$/i.test(unit.file)) return 'client';
  if (unit.isModule) return 'other';
  if (unit.isAnonymous) return 'other';
  return 'service';
}

export type { ArgValue };
