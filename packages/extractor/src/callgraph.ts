import type { CodeUnit, RepoFacts, TypeFacts } from './model.js';
import { normIdent, receiverType, stripGenerics } from './plugins/util.js';

/** Methods that are overwhelmingly library calls; never resolve these by bare name. */
const NOISY = new Set([
  'get', 'post', 'put', 'patch', 'delete', 'send', 'subscribe', 'publish', 'consume', 'run', 'connect', 'log', 'json', 'status', 'map', 'filter',
  'forEach', 'push', 'then', 'catch', 'toString', 'ToString', 'Add', 'add', 'set', 'has', 'keys', 'values', 'Ok', 'NotFound', 'BadRequest',
  'use', 'listen', 'require', 'resolve', 'reject', 'Parse', 'parse', 'stringify', 'Select', 'Where', 'First', 'FirstOrDefault', 'ToList', 'ToArray',
  'Any', 'Count', 'Equals', 'GetType', 'Dispose', 'Start', 'Stop', 'ReadAsync', 'WriteAsync', 'Subscribe', 'Produce', 'ProduceAsync', 'Consume',
]);

function implementationsOf(repo: RepoFacts, typeName: string): TypeFacts[] {
  const t = repo.types.get(typeName);
  const impls = [...repo.types.values()].filter((x) => !x.isInterface && x.baseTypes.some((b) => stripGenerics(b) === typeName));
  if (impls.length) return impls;
  if (t && !t.isInterface) return [t];
  if (/^I[A-Z]/.test(typeName)) {
    const direct = repo.types.get(typeName.slice(1));
    if (direct) return [direct];
  }
  return t ? [t] : [];
}

function methodUnit(repo: RepoFacts, type: TypeFacts, method: string): CodeUnit | undefined {
  for (const id of type.methods) {
    const u = repo.unitById.get(id);
    if (u && u.name.split('.').pop() === method) return u;
  }
  // inherited
  for (const b of type.baseTypes) {
    const bt = repo.types.get(stripGenerics(b) ?? '');
    if (bt && bt !== type) {
      const u = methodUnit(repo, bt, method);
      if (u) return u;
    }
  }
  return undefined;
}

/** Resolve a callee for an invocation within `unit`. Returns the callee unit id or undefined. */
export function resolveCallee(repo: RepoFacts, unit: CodeUnit, receiver: string | undefined, method: string): string | undefined {
  const ownType = unit.typeName ? repo.types.get(unit.typeName) : undefined;

  // bare call or this.method()
  if (!receiver || receiver === 'this' || receiver === 'super' || receiver === 'base') {
    if (ownType) {
      const u = methodUnit(repo, ownType, method);
      if (u) return u.id;
    }
    const sameFile = repo.units.filter((u) => u.file === unit.file && !u.typeName && u.name === method);
    if (sameFile.length === 1) return sameFile[0].id;
    // imported function from another file (same name, not noisy)
    if (!NOISY.has(method)) {
      const ff = repo.files.find((f) => f.path === unit.file);
      const importsIt = ff?.imports.some((i) => i.names.includes(method));
      const cands = repo.units.filter((u) => !u.typeName && u.name === method);
      if (importsIt && cands.length >= 1) return cands[0].id;
      if (cands.length === 1) return cands[0].id;
    }
    return undefined;
  }

  // receiver is a field / parameter with a known type
  const rtype = receiverType(repo, unit, receiver);
  if (rtype) {
    for (const impl of implementationsOf(repo, rtype)) {
      const u = methodUnit(repo, impl, method);
      if (u) return u.id;
    }
    const iface = repo.types.get(rtype);
    if (iface) {
      const u = methodUnit(repo, iface, method);
      if (u) return u.id;
    }
    return undefined;
  }

  // receiver is a static type name: Type.Method()
  const asType = repo.types.get(receiver);
  if (asType) {
    const u = methodUnit(repo, asType, method);
    if (u) return u.id;
  }

  // receiver is a module-level variable created by `new X()` or an imported module namespace
  const ref = repo.refs.get(`${unit.file}:${receiver}`) ?? repo.refs.get(receiver);
  const newType = ref ? /^new\s+([A-Za-z_][\w]*)/.exec(ref)?.[1] : undefined;
  if (newType) {
    for (const impl of implementationsOf(repo, newType)) {
      const u = methodUnit(repo, impl, method);
      if (u) return u.id;
    }
  }
  const ff = repo.files.find((f) => f.path === unit.file);
  const imp = ff?.imports.find((i) => i.names.includes(receiver));
  if (imp) {
    const cands = repo.units.filter((u) => u.name === method || u.name.endsWith(`.${method}`));
    if (cands.length === 1) return cands[0].id;
    // receiver as a capitalised type name (e.g. ordersService -> OrdersService)
    const typeName = receiver.charAt(0).toUpperCase() + receiver.slice(1);
    const t = repo.types.get(typeName);
    if (t) return methodUnit(repo, t, method)?.id;
  }

  // last resort: unique same-file match on type-qualified method name
  if (!NOISY.has(method)) {
    const typeName = receiver.charAt(0).toUpperCase() + receiver.slice(1);
    const t = repo.types.get(typeName) ?? repo.types.get(typeName.replace(/^_+/, ''));
    if (t) {
      const u = methodUnit(repo, t, method);
      if (u) return u.id;
    }
    const sameFile = repo.units.filter((u) => u.file === unit.file && u.name.split('.').pop() === method && u !== unit);
    if (sameFile.length === 1) return sameFile[0].id;
  }
  return undefined;
}

/** Compute direct callee ids for each unit. */
export function buildCallGraph(repo: RepoFacts): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const unit of repo.units) {
    const callees = new Set<string>();
    for (const id of unit.anonymousChildren) if (repo.unitById.has(id)) callees.add(id);
    for (const inv of unit.invocations) {
      const receiver = inv.receiver ? inv.receiverChain[inv.receiverChain.length - 1] : undefined;
      // chained calls like this.svc.get().then(): use the base receiver with the first chained method
      const method = inv.chain.length ? inv.chain[0] : inv.method;
      const callee = resolveCallee(repo, unit, inv.receiver === undefined ? undefined : (receiver ?? inv.receiver), method);
      if (callee && callee !== unit.id) callees.add(callee);
      if (inv.chain.length) {
        const c2 = resolveCallee(repo, unit, inv.receiver === undefined ? undefined : (receiver ?? inv.receiver), inv.method);
        if (c2 && c2 !== unit.id) callees.add(c2);
      }
      // handler references passed as arguments (e.g. route(handler), map(fn))
      for (const a of inv.args) {
        if (a.kind === 'ident') {
          const u = repo.units.find((x) => x.file === unit.file && !x.typeName && x.name === a.value);
          if (u && u !== unit) callees.add(u.id);
        }
      }
    }
    graph.set(unit.id, callees);
  }
  return graph;
}

export { normIdent };
