import type { HttpMethod } from '@codegraph/schema';
import type { ArgValue, CodeUnit, Invocation, RepoFacts, TypeFacts } from '../model.js';
import type { Plugin, PluginContext } from './types.js';
import { HTTP_VERBS, configKeyFromExpr, hostOf, isUrlLike, methodFromWord, normIdent, receiverType, slug } from './util.js';

const DOTNET_METHODS: Record<string, HttpMethod> = {
  GetAsync: 'GET',
  GetStringAsync: 'GET',
  GetStreamAsync: 'GET',
  GetByteArrayAsync: 'GET',
  GetFromJsonAsync: 'GET',
  PostAsync: 'POST',
  PostAsJsonAsync: 'POST',
  PutAsync: 'PUT',
  PutAsJsonAsync: 'PUT',
  PatchAsync: 'PATCH',
  PatchAsJsonAsync: 'PATCH',
  DeleteAsync: 'DELETE',
  DeleteFromJsonAsync: 'DELETE',
  SendAsync: 'ANY',
  Send: 'ANY',
};

const REFIT_ATTRS: Record<string, HttpMethod> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS' };

const JAVA_REST_TEMPLATE: Record<string, HttpMethod> = {
  getForObject: 'GET',
  getForEntity: 'GET',
  postForObject: 'POST',
  postForEntity: 'POST',
  postForLocation: 'POST',
  put: 'PUT',
  patchForObject: 'PATCH',
  delete: 'DELETE',
  headForHeaders: 'HEAD',
  optionsForAllow: 'OPTIONS',
  exchange: 'ANY',
  execute: 'ANY',
};

const JS_HTTP_LIBS = /^(axios|fetch|got|ky|superagent|needle|request|undici|\$http|http|https)$/;
const CLIENT_TYPE = /HttpClient|HttpService|AxiosInstance|RestTemplate|WebClient|RestClient|OkHttpClient|IHttpClientFactory|Got|KyInstance/;
const CLIENT_NAME = /client|http|api|gateway|proxy|rest|fetcher/i;

function isClientType(t: TypeFacts): boolean {
  return /Client|Gateway|Proxy|Api$|ApiService$|Connector|Adapter/.test(t.name) && !/Controller/.test(t.name) && !t.attrs.some((a) => a.name === 'Controller');
}

interface Registrations {
  /** typed client type name -> config key / base url hint */
  typed: Map<string, string>;
  /** named client name -> config key hint */
  named: Map<string, string>;
}

function hintFromLambda(ctx: PluginContext, inv: Invocation): string | undefined {
  const fn = inv.args.find((a) => a.kind === 'function');
  const unit = fn ? ctx.repo.unitById.get(fn.value) : undefined;
  if (!unit) return undefined;
  const key = configKeyFromExpr(unit.body);
  if (key) return key;
  const s = unit.strings.find((x) => hostOf(x));
  return s ? hostOf(s) : unit.strings[0];
}

function collectRegistrations(ctx: PluginContext): Registrations {
  const reg: Registrations = { typed: new Map(), named: new Map() };
  const { repo } = ctx;
  for (const unit of repo.units) {
    const invs = unit.invocations;
    for (const inv of invs) {
      if (inv.method === 'AddHttpClient' || inv.method === 'AddRefitClient' || inv.method === 'AddHttpApi') {
        const lambdaHint = hintFromLambda(ctx, inv);
        const t = inv.typeArgs?.[0];
        const name = inv.args[0]?.kind === 'string' ? inv.args[0].value : undefined;
        if (t) {
          reg.typed.set(t, lambdaHint ?? name ?? slug(t.replace(/^I(?=[A-Z])/, '')));
          ctx.clientUnits.add(t);
        }
        if (name) reg.named.set(name, lambdaHint ?? name);
      }
      if ((inv.method === 'ConfigureHttpClient' || inv.method === 'ConfigurePrimaryHttpMessageHandler') && inv.chain.some((c) => /AddHttpClient|AddRefitClient/.test(c))) {
        const inner = invs.filter((i) => /AddHttpClient|AddRefitClient/.test(i.method) && i.line <= inv.line).sort((a, b) => b.line - a.line)[0];
        const lambdaHint = hintFromLambda(ctx, inv);
        if (inner && lambdaHint) {
          const t = inner.typeArgs?.[0];
          const name = inner.args[0]?.kind === 'string' ? inner.args[0].value : undefined;
          if (t) reg.typed.set(t, lambdaHint);
          if (name) reg.named.set(name, lambdaHint);
        }
      }
    }
  }
  return reg;
}

function createClientName(units: CodeUnit[]): string | undefined {
  for (const u of units) {
    const inv = u.invocations.find((i) => i.method === 'CreateClient' && i.args[0]?.kind === 'string');
    if (inv) return inv.args[0].value;
  }
  return undefined;
}

function resolveUrlArg(ctx: PluginContext, unit: CodeUnit, arg: ArgValue | undefined): string | undefined {
  if (!arg) return undefined;
  if (arg.kind === 'string' || arg.kind === 'template') return arg.value;
  const r = ctx.resolveString(arg, unit);
  if (r?.resolved) return r.value;
  if (arg.kind === 'ident' || arg.kind === 'member') {
    // local variable assigned from a string/template in the same unit
    const name = arg.value.split('.').pop()!;
    const m = new RegExp(`(?:var|string|const|let|final\\s+String|String)\\s+${name}\\s*=\\s*([^;]+);`).exec(unit.body);
    if (m) {
      const expr = m[1].trim();
      const inner = /^\$?@?"(.*)"$/.exec(expr) ?? /^`(.*)`$/.exec(expr) ?? /^'(.*)'$/.exec(expr);
      if (inner) return inner[1].replace(/\$\{([^}]+)\}|\{([^}]+)\}/g, (_: string, a: string, b: string) => `{${(a ?? b).split('.').pop()!.replace(/^_+/, '').replace(/[^\w]/g, '')}}`);
      return `{${name}}`;
    }
    return `{${name}}`;
  }
  return undefined;
}

function sendAsyncRequest(unit: CodeUnit): { method?: HttpMethod; url?: string } {
  const m = /new\s+HttpRequestMessage\s*\(\s*HttpMethod\.(\w+)\s*,\s*((?:\$?@?"[^"]*")|[^,)]+)\s*[,)]/.exec(unit.body);
  if (!m) return {};
  const method = methodFromWord(m[1]);
  let url = m[2].trim();
  const str = /^\$?@?"(.*)"$/.exec(url);
  url = str ? str[1].replace(/\{([^}]+)\}/g, (_: string, e: string) => `{${e.split('.').pop()!.replace(/^_+/, '')}}`) : `{${url.replace(/[^\w]/g, '')}}`;
  return { method, url };
}

export const httpClients: Plugin = {
  name: 'http-clients',
  detect() {
    return true;
  },
  apply(ctx) {
    const { repo } = ctx;
    const reg = collectRegistrations(ctx);
    for (const t of repo.types.values()) if (isClientType(t)) ctx.clientUnits.add(t.name);

    const typeUnits = (typeName: string | undefined) => repo.units.filter((u) => u.typeName === typeName);

    for (const unit of repo.units) {
      const type = unit.typeName ? repo.types.get(unit.typeName) : undefined;
      const lang = repo.files.find((f) => f.path === unit.file)?.language;

      // Refit interface methods
      if (lang === 'csharp' && type?.isInterface && unit.isAbstract) {
        for (const a of unit.attrs) {
          const method = REFIT_ATTRS[a.name];
          if (!method || a.args[0] === undefined) continue;
          const hint = reg.typed.get(type.name) ?? slug(type.name.replace(/^I(?=[A-Z])/, ''));
          ctx.clientUnits.add(type.name);
          ctx.addCall({ method, url: a.args[0], targetHint: hint, targetService: ctx.targetFor(hint), fromHandler: unit.id, location: ctx.loc(unit) });
        }
        continue;
      }

      for (const inv of unit.invocations) {
        const receiver = inv.receiverChain[inv.receiverChain.length - 1];
        const rtype = receiver ? receiverType(repo, unit, receiver) : undefined;

        /* ---------- .NET HttpClient ---------- */
        if (lang === 'csharp' && inv.method in DOTNET_METHODS) {
          let method = DOTNET_METHODS[inv.method];
          let url = resolveUrlArg(ctx, unit, inv.args[0]);
          if (inv.method === 'SendAsync' || inv.method === 'Send') {
            const req = sendAsyncRequest(unit);
            method = req.method ?? method;
            url = req.url ?? url;
          }
          if (!url) {
            ctx.issue('info', 'dynamic-url', `${unit.name}: ${inv.method} with non-literal URL`, ctx.loc(unit, inv.line));
            url = '{dynamic}';
          }
          let hint = ctx.hintFor(inv.args[0], unit);
          if (!hint || !isStrongHint(hint)) {
            const sameUnitClient = createClientName([unit]);
            const typeClient = sameUnitClient ?? (unit.typeName ? createClientName(typeUnits(unit.typeName)) : undefined);
            const typed = unit.typeName ? reg.typed.get(unit.typeName) : undefined;
            if (sameUnitClient) hint = reg.named.get(sameUnitClient) ?? sameUnitClient;
            else if (typed) hint = typed;
            else if (typeClient) hint = reg.named.get(typeClient) ?? typeClient;
            else if (type && ctx.clientUnits.has(type.name)) hint = hint ?? slug(type.name.replace(/^I(?=[A-Z])/, ''));
            else if (receiver && rtype && !CLIENT_TYPE.test(rtype)) continue; // not an HttpClient
            hint = hint ?? (receiver ? normIdent(receiver) : undefined);
          }
          ctx.addCall({ method, url, targetHint: hint, targetService: ctx.targetFor(hint), fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          continue;
        }

        /* ---------- Java RestTemplate / WebClient / RestClient ---------- */
        if (lang === 'java') {
          const restish = (rtype && CLIENT_TYPE.test(rtype)) || (receiver && /rest|http|client|web/i.test(receiver));
          if (inv.method in JAVA_REST_TEMPLATE && restish && inv.args.length) {
            let method = JAVA_REST_TEMPLATE[inv.method];
            if (method === 'ANY') {
              const m = inv.args.find((a) => a.kind === 'member' && /HttpMethod\./.test(a.value));
              if (m) method = methodFromWord(m.value.split('.').pop()!) ?? 'ANY';
            }
            const url = resolveUrlArg(ctx, unit, inv.args[0]) ?? '{dynamic}';
            const hint = ctx.hintFor(inv.args[0], unit) ?? baseUrlHint(ctx, unit) ?? (receiver ? normIdent(receiver) : undefined);
            ctx.addCall({ method, url, targetHint: hint, targetService: ctx.targetFor(hint), fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
            continue;
          }
          if (inv.method === 'uri' && inv.chain.length && restish) {
            const verb = [...inv.chain].reverse().find((c) => c in HTTP_VERBS || c === 'method');
            let method: HttpMethod = verb && verb in HTTP_VERBS ? HTTP_VERBS[verb] : 'ANY';
            if (verb === 'method') {
              const mm = /\.method\(\s*HttpMethod\.(\w+)/.exec(inv.raw);
              if (mm) method = methodFromWord(mm[1]) ?? 'ANY';
            }
            const url = resolveUrlArg(ctx, unit, inv.args[0]) ?? '{dynamic}';
            const hint = ctx.hintFor(inv.args[0], unit) ?? baseUrlHint(ctx, unit) ?? (receiver ? normIdent(receiver) : undefined);
            ctx.addCall({ method, url, targetHint: hint, targetService: ctx.targetFor(hint), fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
            continue;
          }
        }

        /* ---------- JavaScript / TypeScript ---------- */
        if (lang === 'typescript' || lang === 'javascript') {
          const call = jsHttpCall(ctx, unit, inv, receiver, rtype);
          if (call) {
            ctx.addCall({ ...call, targetService: ctx.targetFor(call.targetHint), fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          }
        }
      }
    }
  },
};

function isStrongHint(h: string): boolean {
  return /[:.\/_]/.test(h) || /^[A-Z0-9_]{4,}$/.test(h);
}

/** Find baseUrl()/rootUri()/create("http..") in the enclosing type's units. */
function baseUrlHint(ctx: PluginContext, unit: CodeUnit): string | undefined {
  if (!unit.typeName) return undefined;
  for (const u of ctx.repo.units.filter((x) => x.typeName === unit.typeName)) {
    const inv = u.invocations.find((i) => /^(baseUrl|rootUri|create|baseURL)$/.test(i.method) && i.args[0]);
    if (inv) {
      const h = ctx.hintFor(inv.args[0], u);
      if (h) return h;
    }
  }
  return undefined;
}

function jsHttpCall(ctx: PluginContext, unit: CodeUnit, inv: Invocation, receiver: string | undefined, rtype: string | undefined): { method: HttpMethod; url: string; targetHint?: string } | undefined {
  const { repo } = ctx;
  const a0 = inv.args[0];
  const opts = inv.args.find((a) => a.kind === 'object');
  const methodFromOpts = opts?.props?.method ? methodFromWord(opts.props.method) : undefined;

  // fetch(url, { method })
  if (inv.method === 'fetch' && (!receiver || /^(window|globalThis|global|self)$/.test(receiver)) && a0) {
    const url = resolveUrlArg(ctx, unit, a0) ?? '{dynamic}';
    return { method: methodFromOpts ?? 'GET', url, targetHint: ctx.hintFor(a0, unit) };
  }
  // axios({ url, method }) / axios(url, opts)
  if (inv.method === 'axios' && !receiver) {
    if (a0?.kind === 'object' && a0.props?.url) return { method: methodFromWord(a0.props.method ?? 'GET') ?? 'GET', url: a0.props.url, targetHint: ctx.hintFor({ kind: 'string', value: a0.props.url, raw: '' }, unit) };
    if (a0 && a0.kind !== 'object') return { method: methodFromOpts ?? 'GET', url: resolveUrlArg(ctx, unit, a0) ?? '{dynamic}', targetHint: ctx.hintFor(a0, unit) };
  }
  if (!receiver) return undefined;
  const verb = HTTP_VERBS[inv.method] ?? (inv.method === 'request' ? (methodFromOpts ?? 'ANY') : undefined);
  if (!verb) return undefined;
  if (!a0 || (a0.kind !== 'string' && a0.kind !== 'template' && a0.kind !== 'ident' && a0.kind !== 'member' && a0.kind !== 'object')) return undefined;
  // route registrations have function handlers; skip those
  if (inv.args.some((a) => a.kind === 'function')) return undefined;

  // Is the receiver an HTTP client?
  let instanceHint: string | undefined;
  let isClient = JS_HTTP_LIBS.test(receiver) || (rtype !== undefined && CLIENT_TYPE.test(rtype));
  const instance = repo.variables.get(`${unit.file}:${receiver}`) ?? repo.variables.get(receiver);
  const fieldUnit = unit.typeName ? repo.unitById.get(`${unit.typeName}.${receiver}`) : undefined;
  const creator = instance ?? fieldUnit?.invocations.find((i) => i.method === 'create' || i.method === 'extend');
  if (creator && (creator.receiver === 'axios' || creator.receiver === 'got' || creator.receiver === 'ky' || creator.method === 'create')) {
    isClient = true;
    const cfg = creator.args.find((a) => a.kind === 'object');
    const base = cfg?.props?.baseURL ?? cfg?.props?.prefixUrl ?? cfg?.props?.baseUrl;
    if (base) {
      instanceHint = hostOf(base) ?? ctx.hintFor({ kind: base.startsWith('http') || base.startsWith('/') ? 'string' : 'ident', value: base, raw: base }, fieldUnit ?? unit);
    }
  }
  if (!isClient && CLIENT_NAME.test(receiver) && a0.kind !== 'object' && isUrlLike(a0.value)) isClient = true;
  if (!isClient) return undefined;

  let url: string | undefined;
  if (a0.kind === 'object') url = a0.props?.url;
  else url = resolveUrlArg(ctx, unit, a0);
  if (!url) return undefined;
  const hint = (a0.kind !== 'object' ? ctx.hintFor(a0, unit) : undefined) ?? instanceHint;
  return { method: verb, url, targetHint: hint && isStrongHint(hint) ? hint : (instanceHint ?? hint) };
}
