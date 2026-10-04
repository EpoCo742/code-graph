import path from 'node:path';
import type { Node } from 'web-tree-sitter';
import { children, endLine, field, line, placeholder, unquote } from '../parser.js';
import type { ArgValue, Attr, CodeUnit, Invocation, Param } from '../model.js';

/** Per-language node-type vocabulary for expression extraction. */
export interface LangSpec {
  stringTypes: string[];
  templateTypes: string[];
  templateSubstitution: string;
  stringContent: string[];
  identifier: string[];
  /** [nodeType, objectField, nameField] */
  memberTypes: [string, string, string][];
  invocationType: string;
  /** How to find callee and args on an invocation node. */
  invocation: { functionField?: string; objectField?: string; nameField?: string; argumentsField: string; typeArgsField?: string };
  functionTypes: string[];
  functionBodyField: string;
  /** Wrapper node around each argument (C# "argument" with optional name field). */
  argumentWrapper?: { type: string; nameField: string };
  objectType?: string;
  pairType?: { type: string; keyField: string; valueField: string };
  arrayTypes: string[];
  binaryType: string;
  newTypes: { type: string; typeField: string }[];
  /** Nodes whose single child should be looked through (await, parenthesized, cast). */
  transparent: string[];
  genericNameType?: string;
}

export function fileId(repoRoot: string, file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

/** Collect string content from a string literal node, joining fragments and escapes. */
export function stringValue(node: Node, spec: LangSpec): string {
  const kids = children(node);
  if (kids.length === 0) return unquote(node.text);
  let out = '';
  let any = false;
  for (const k of kids) {
    if (spec.stringContent.includes(k.type) || k.type === 'escape_sequence') {
      out += k.text;
      any = true;
    }
  }
  return any ? out : unquote(node.text);
}

/** Render a template / interpolated string with placeholders; returns [value, interpolations]. */
export function templateValue(node: Node, spec: LangSpec): [string, string[]] {
  let out = '';
  const interps: string[] = [];
  for (const k of children(node)) {
    if (k.type === spec.templateSubstitution) {
      const inner = children(k).filter((c) => c.type !== 'interpolation_brace');
      const expr = inner.map((c) => c.text).join('').trim() || k.text.replace(/^[${]+|}$/g, '').trim();
      interps.push(expr);
      out += placeholder(expr);
    } else if (spec.stringContent.includes(k.type) || k.type === 'escape_sequence') {
      out += k.text;
    }
  }
  return [out, interps];
}

function lookThrough(node: Node, spec: LangSpec): Node {
  let n = node;
  while (spec.transparent.includes(n.type)) {
    const kids = children(n);
    if (kids.length !== 1) {
      // cast: (Type) expr -> take last
      const last = kids[kids.length - 1];
      if (!last) break;
      n = last;
    } else n = kids[0];
  }
  return n;
}

export interface ExprContext {
  spec: LangSpec;
  file: string;
  /** Called when an anonymous function node is encountered; returns its unit id. */
  onFunction: (node: Node) => string;
}

/** Convert an expression node into an ArgValue. */
export function exprToArg(raw: Node, ctx: ExprContext): ArgValue {
  const spec = ctx.spec;
  const node = lookThrough(raw, spec);
  const text = node.text;
  if (spec.stringTypes.includes(node.type)) {
    // C# $"..." is interpolated_string_expression; plain string here.
    return { kind: 'string', value: stringValue(node, spec), raw: text };
  }
  if (spec.templateTypes.includes(node.type)) {
    const [value, interpolations] = templateValue(node, spec);
    if (interpolations.length === 0) return { kind: 'string', value, raw: text };
    return { kind: 'template', value, raw: text, interpolations };
  }
  if (spec.identifier.includes(node.type)) return { kind: 'ident', value: text, raw: text };
  for (const [mt, objF, nameF] of spec.memberTypes) {
    if (node.type === mt) {
      const obj = field(node, objF);
      const name = field(node, nameF);
      const value = `${obj ? exprToArg(obj, ctx).value : ''}.${name?.text ?? ''}`.replace(/^this\./, '');
      return { kind: 'member', value, raw: text };
    }
  }
  if (spec.functionTypes.includes(node.type)) {
    return { kind: 'function', value: ctx.onFunction(node), raw: text.slice(0, 80) };
  }
  if (node.type === spec.binaryType) {
    // string concatenation: a + "/x" + b
    const parts: string[] = [];
    const interps: string[] = [];
    const flatten = (n: Node) => {
      const m = lookThrough(n, spec);
      if (m.type === spec.binaryType) {
        const kids = children(m);
        for (const k of kids) flatten(k);
        return;
      }
      const a = exprToArg(m, ctx);
      if (a.kind === 'string') parts.push(a.value);
      else if (a.kind === 'template') {
        parts.push(a.value);
        interps.push(...(a.interpolations ?? []));
      } else {
        parts.push(placeholder(a.value || m.text));
        interps.push(m.text);
      }
    };
    flatten(node);
    const value = parts.join('');
    if (interps.length === 0) return { kind: 'string', value, raw: text };
    return { kind: 'template', value, raw: text, interpolations: interps };
  }
  if (spec.objectType && node.type === spec.objectType && spec.pairType) {
    const props: Record<string, string> = {};
    for (const k of children(node)) {
      if (k.type !== spec.pairType.type) continue;
      const key = field(k, spec.pairType.keyField);
      const val = field(k, spec.pairType.valueField);
      if (!key || !val) continue;
      const a = exprToArg(val, ctx);
      props[unquote(key.text)] = a.kind === 'array' ? (a.items ?? []).join(',') : a.value;
    }
    return { kind: 'object', value: JSON.stringify(props), raw: text.slice(0, 120), props };
  }
  if (spec.arrayTypes.includes(node.type)) {
    const items = children(node)
      .map((k) => exprToArg(k, ctx))
      .filter((a) => a.kind !== 'other')
      .map((a) => a.value);
    return { kind: 'array', value: items.join(','), raw: text.slice(0, 120), items };
  }
  for (const nt of spec.newTypes) {
    if (node.type === nt.type) {
      const t = field(node, nt.typeField);
      let tn = t?.text ?? '';
      if (t && spec.genericNameType && t.type === spec.genericNameType) tn = children(t)[0]?.text ?? tn;
      return { kind: 'other', value: `new ${tn}`, raw: text.slice(0, 120) };
    }
  }
  if (node.type === spec.invocationType) {
    return { kind: 'other', value: text.slice(0, 120), raw: text.slice(0, 120) };
  }
  return { kind: 'other', value: text.slice(0, 120), raw: text.slice(0, 120) };
}

/** Parse an invocation node into an Invocation. */
export function parseInvocation(node: Node, ctx: ExprContext): Invocation | undefined {
  const spec = ctx.spec;
  const inv = spec.invocation;
  let calleeObj: Node | null = null;
  let nameNode: Node | null = null;
  let typeArgs: string[] | undefined;

  if (inv.functionField) {
    const fn = field(node, inv.functionField);
    if (!fn) return undefined;
    const f = lookThrough(fn, spec);
    const mt = spec.memberTypes.find(([t]) => t === f.type);
    if (mt) {
      calleeObj = field(f, mt[1]);
      nameNode = field(f, mt[2]);
    } else if (spec.identifier.includes(f.type)) {
      nameNode = f;
    } else if (spec.genericNameType && f.type === spec.genericNameType) {
      nameNode = children(f)[0] ?? null;
      typeArgs = typeArgsOf(f);
    } else {
      return undefined; // e.g. calling a call result
    }
  } else {
    calleeObj = inv.objectField ? field(node, inv.objectField) : null;
    nameNode = inv.nameField ? field(node, inv.nameField) : null;
  }
  if (!nameNode) return undefined;
  if (spec.genericNameType && nameNode.type === spec.genericNameType) {
    typeArgs = typeArgsOf(nameNode);
    nameNode = children(nameNode)[0] ?? nameNode;
  }
  if (inv.typeArgsField) {
    const ta = field(node, inv.typeArgsField);
    if (ta) typeArgs = children(ta).map((c) => c.text);
  }
  const method = nameNode.text;

  // Receiver and chain: unwind nested invocations.
  const chain: string[] = [];
  let receiver: string | undefined;
  let cur = calleeObj ? lookThrough(calleeObj, spec) : null;
  while (cur) {
    if (cur.type === spec.invocationType) {
      const innerInv = parseInvocation(cur, { ...ctx, onFunction: () => '' });
      if (innerInv) {
        chain.unshift(innerInv.method);
        receiver = innerInv.receiver;
        if (innerInv.chain.length) chain.unshift(...innerInv.chain);
      }
      break;
    }
    receiver = exprToArg(cur, ctx).value || cur.text;
    break;
  }

  const argsNode = field(node, inv.argumentsField);
  const args: ArgValue[] = [];
  if (argsNode) {
    for (const a of children(argsNode)) {
      if (spec.argumentWrapper && a.type === spec.argumentWrapper.type) {
        const nm = field(a, spec.argumentWrapper.nameField);
        const valNode = children(a).find((c) => !nm || c.id !== nm.id);
        if (!valNode) continue;
        const v = exprToArg(valNode, ctx);
        if (nm) v.name = nm.text;
        args.push(v);
      } else {
        args.push(exprToArg(a, ctx));
      }
    }
  }
  const receiverChain = (receiver ?? '')
    .split('.')
    .filter((p) => p && p !== 'this')
    .map((p) => p.replace(/^_+/, ''));
  return { receiver, receiverChain, method, typeArgs, args, chain, line: line(node), raw: node.text.slice(0, 200) };
}

function typeArgsOf(generic: Node): string[] {
  const list = children(generic).find((c) => c.type.includes('type_argument'));
  return list ? children(list).map((c) => c.text) : [];
}

export interface UnitBuilder {
  file: string;
  spec: LangSpec;
  units: CodeUnit[];
  anonCounter: number;
}

/**
 * Walk a body node collecting invocations into `unit`; nested function
 * expressions become separate anonymous units linked via anonymousChildren.
 */
export function collectBody(body: Node, unit: CodeUnit, b: UnitBuilder): void {
  const spec = b.spec;
  const ctx: ExprContext = {
    spec,
    file: b.file,
    onFunction: (fnNode) => {
      const id = `${b.file}:anon@${line(fnNode)}:${fnNode.startPosition.column}`;
      const existing = b.units.find((u) => u.id === id);
      if (existing) return id;
      const anon: CodeUnit = {
        id,
        name: `${path.basename(b.file)}:${line(fnNode)} (anonymous)`,
        typeName: unit.typeName,
        file: b.file,
        line: line(fnNode),
        endLine: endLine(fnNode),
        attrs: [],
        params: paramsOf(field(fnNode, 'parameters'), spec),
        body: fnNode.text,
        invocations: [],
        strings: [],
        isAnonymous: true,
        anonymousChildren: [],
      };
      b.units.push(anon);
      unit.anonymousChildren.push(id);
      const fb = field(fnNode, spec.functionBodyField) ?? children(fnNode)[children(fnNode).length - 1];
      if (fb) collectBody(fb, anon, b);
      return id;
    },
  };
  const visit = (n: Node) => {
    if (n.type === spec.invocationType) {
      const inv = parseInvocation(n, ctx);
      if (inv) unit.invocations.push(inv);
      // continue into arguments for nested invocations, but function args were handled by onFunction
      const argsNode = field(n, spec.invocation.argumentsField);
      const callee = spec.invocation.functionField ? field(n, spec.invocation.functionField) : field(n, spec.invocation.objectField ?? '');
      if (callee) visit(callee);
      if (argsNode) {
        for (const a of children(argsNode)) {
          const inner = spec.argumentWrapper && a.type === spec.argumentWrapper.type ? children(a) : [a];
          for (const i of inner) {
            if (spec.functionTypes.includes(lookThrough(i, spec).type)) continue;
            visit(i);
          }
        }
      }
      return;
    }
    if (spec.functionTypes.includes(n.type)) {
      ctx.onFunction(n);
      return;
    }
    if (spec.stringTypes.includes(n.type)) {
      unit.strings.push(stringValue(n, spec));
      return;
    }
    if (spec.templateTypes.includes(n.type)) {
      unit.strings.push(templateValue(n, spec)[0]);
      // keep walking for nested invocations in substitutions
    }
    for (const k of children(n)) visit(k);
  };
  visit(body);
}

export function paramsOf(list: Node | null, spec: LangSpec): Param[] {
  if (!list) return [];
  const out: Param[] = [];
  for (const p of children(list)) {
    const name = field(p, 'name') ?? field(p, 'pattern');
    const type = field(p, 'type');
    if (!name) continue;
    let t = type?.text;
    if (t?.startsWith(':')) t = t.slice(1).trim();
    out.push({ name: name.text, type: t });
  }
  return out;
}

/** Build an Attr from a name and an argument list node. */
export function makeAttr(name: string, argList: Node | null, spec: LangSpec, ctx: ExprContext): Attr {
  const attr: Attr = { name: name.replace(/Attribute$/, ''), args: [], named: {}, raw: '' };
  if (!argList) return attr;
  attr.raw = argList.text;
  for (const a of children(argList)) {
    // Java element_value_pair, C# attribute_argument with name, TS object arg
    if (a.type === 'element_value_pair') {
      const k = field(a, 'key');
      const v = field(a, 'value');
      if (k && v) attr.named[k.text] = valueText(v, spec, ctx);
      continue;
    }
    if (a.type === 'attribute_argument' || a.type === 'argument') {
      const nm = field(a, 'name');
      const val = children(a).find((c) => !nm || c.id !== nm.id);
      if (!val) continue;
      const vt = valueText(val, spec, ctx);
      if (nm) attr.named[nm.text] = vt;
      else attr.args.push(vt);
      continue;
    }
    const v = exprToArg(a, ctx);
    if (v.kind === 'object' && v.props) Object.assign(attr.named, v.props);
    else attr.args.push(v.kind === 'array' ? (v.items ?? []).join(',') : v.value);
  }
  return attr;
}

function valueText(v: Node, spec: LangSpec, ctx: ExprContext): string {
  const a = exprToArg(v, ctx);
  if (a.kind === 'array') return (a.items ?? []).join(',');
  return a.value;
}
