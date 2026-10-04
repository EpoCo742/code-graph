import path from 'node:path';
import type { Node } from 'web-tree-sitter';
import { children, endLine, field, line, parse, type Grammar } from '../parser.js';
import type { Attr, CodeUnit, FileFacts, LanguageId, Param, TypeFacts } from '../model.js';
import { collectBody, exprToArg, makeAttr, paramsOf, parseInvocation, type ExprContext, type LangSpec, type UnitBuilder } from './common.js';

export const tsSpec: LangSpec = {
  stringTypes: ['string'],
  templateTypes: ['template_string'],
  templateSubstitution: 'template_substitution',
  stringContent: ['string_fragment'],
  identifier: ['identifier', 'this'],
  memberTypes: [['member_expression', 'object', 'property']],
  invocationType: 'call_expression',
  invocation: { functionField: 'function', argumentsField: 'arguments', typeArgsField: 'type_arguments' },
  functionTypes: ['arrow_function', 'function_expression', 'function'],
  functionBodyField: 'body',
  objectType: 'object',
  pairType: { type: 'pair', keyField: 'key', valueField: 'value' },
  arrayTypes: ['array'],
  binaryType: 'binary_expression',
  newTypes: [{ type: 'new_expression', typeField: 'constructor' }],
  transparent: ['await_expression', 'parenthesized_expression', 'as_expression', 'non_null_expression', 'satisfies_expression', 'type_assertion'],
};

function decoratorToAttr(dec: Node, ctx: ExprContext): Attr | undefined {
  const inner = children(dec)[0];
  if (!inner) return undefined;
  if (inner.type === 'call_expression') {
    const fn = field(inner, 'function');
    const name = fn?.text.split('.').pop() ?? '';
    return makeAttr(name, field(inner, 'arguments'), tsSpec, ctx);
  }
  return { name: inner.text.split('.').pop() ?? inner.text, args: [], named: {}, raw: '' };
}

export async function parseTypeScript(file: string, source: string, grammar: Grammar): Promise<FileFacts> {
  const tree = await parse(grammar, source);
  const root = tree.rootNode;
  const language: LanguageId = grammar === 'javascript' ? 'javascript' : 'typescript';
  const facts: FileFacts = { path: file, language, imports: [], types: [], units: [], constants: {}, variables: {}, refs: {} };
  const b: UnitBuilder = { file, spec: tsSpec, units: facts.units, anonCounter: 0 };
  const ctx: ExprContext = { spec: tsSpec, file, onFunction: () => '' };
  const base = path.basename(file);

  const moduleUnit: CodeUnit = {
    id: `${file}:<module>`,
    name: `${base} (module)`,
    file,
    line: 1,
    endLine: endLine(root),
    attrs: [],
    params: [],
    body: '',
    invocations: [],
    strings: [],
    isModule: true,
    anonymousChildren: [],
  };
  const moduleParts: string[] = [];

  const makeUnit = (node: Node, id: string, name: string, typeName: string | undefined, attrs: Attr[], params: Node | null): CodeUnit => ({
    id,
    name,
    typeName,
    file,
    line: line(node),
    endLine: endLine(node),
    attrs,
    params: paramsOf(params, tsSpec),
    body: node.text,
    invocations: [],
    strings: [],
    anonymousChildren: [],
  });

  const visitClass = (node: Node, pendingDecorators: Node[]) => {
    const name = field(node, 'name')?.text ?? 'AnonymousClass';
    const decs = [...pendingDecorators, ...children(node).filter((c) => c.type === 'decorator')];
    const t: TypeFacts = {
      name,
      file,
      line: line(node),
      isInterface: false,
      attrs: decs.map((d) => decoratorToAttr(d, ctx)).filter((a): a is Attr => !!a),
      baseTypes: [],
      fields: [],
      ctorParams: [],
      methods: [],
      constants: {},
    };
    const heritage = children(node).find((c) => c.type === 'class_heritage');
    if (heritage) {
      for (const h of children(heritage)) {
        for (const k of children(h)) t.baseTypes.push(k.text.replace(/^[a-z_]+\s+/, ''));
        if (children(h).length === 0) t.baseTypes.push(h.text);
      }
    }
    const body = field(node, 'body');
    if (body) {
      let pending: Node[] = [];
      for (const m of children(body)) {
        if (m.type === 'decorator') {
          pending.push(m);
          continue;
        }
        const attrs = pending.map((d) => decoratorToAttr(d, ctx)).filter((a): a is Attr => !!a);
        pending = [];
        if (m.type === 'method_definition') {
          const mname = field(m, 'name')?.text ?? 'method';
          const params = field(m, 'parameters');
          if (mname === 'constructor') {
            const ps = paramsOf(params, tsSpec);
            t.ctorParams.push(...ps);
            // parameter properties become fields
            if (params) {
              for (const p of children(params)) {
                if (children(p).some((c) => c.type === 'accessibility_modifier' || c.type === 'override_modifier')) {
                  const nm = field(p, 'pattern')?.text;
                  const ty = field(p, 'type')?.text.replace(/^:\s*/, '');
                  if (nm) t.fields.push({ name: nm, type: ty });
                }
              }
            }
          }
          const unit = makeUnit(m, `${name}.${mname}`, `${name}.${mname}`, name, attrs, params);
          const mb = field(m, 'body');
          if (mb) collectBody(mb, unit, b);
          facts.units.push(unit);
          t.methods.push(unit.id);
        } else if (m.type === 'public_field_definition' || m.type === 'property_signature') {
          const fname = field(m, 'name')?.text;
          const ftype = field(m, 'type')?.text.replace(/^:\s*/, '');
          if (fname) {
            const p: Param = { name: fname, type: ftype, attrs: attrs.length ? attrs : undefined };
            t.fields.push(p);
            const v = field(m, 'value');
            if (v) {
              const a = exprToArg(v, ctx);
              if (a.kind === 'string') t.constants[fname] = a.value;
              else if (a.kind === 'function') {
                // field arrow function: make it a method unit
                const anon = facts.units.find((u) => u.id === a.value);
                if (anon) {
                  anon.id = `${name}.${fname}`;
                  anon.name = `${name}.${fname}`;
                  anon.isAnonymous = false;
                  anon.attrs = attrs;
                  t.methods.push(anon.id);
                }
              } else if (v.type === 'call_expression') {
                const unit = makeUnit(m, `${name}.${fname}`, `${name}.${fname}`, name, attrs, null);
                collectBody(v, unit, b);
                facts.units.push(unit);
                t.methods.push(unit.id);
              }
            }
          }
        }
      }
    }
    facts.types.push(t);
  };

  const visitDeclarator = (d: Node, attrs: Attr[], exported: boolean) => {
    const nameNode = field(d, 'name');
    const value = field(d, 'value');
    if (!nameNode || !value) return;
    const vname = nameNode.text;
    if (tsSpec.functionTypes.includes(value.type)) {
      const unit = makeUnit(value, `${file}:${vname}`, vname, undefined, attrs, field(value, 'parameters'));
      unit.line = line(d);
      const fb = field(value, 'body');
      if (fb) collectBody(fb, unit, b);
      facts.units.push(unit);
      return;
    }
    const a = exprToArg(value, ctx);
    if (a.kind === 'string') facts.constants[vname] = a.value;
    else if (value.type !== 'call_expression') facts.refs[vname] = value.text;
    if (value.type === 'call_expression') {
      const inv = parseInvocation(value, ctx);
      if (inv) {
        facts.variables[vname] = inv;
        if (inv.method === 'require' && inv.args[0]?.kind === 'string') {
          const names = nameNode.type === 'object_pattern' ? children(nameNode).map((c) => c.text) : [vname];
          facts.imports.push({ names, source: inv.args[0].value });
        }
      }
    }
    moduleParts.push(d.text);
    collectBody(d, moduleUnit, b);
    void exported;
  };

  const visitTop = (node: Node, pendingDecorators: Node[], exported: boolean) => {
    switch (node.type) {
      case 'import_statement': {
        const src = field(node, 'source');
        const names: string[] = [];
        const clause = children(node).find((c) => c.type === 'import_clause');
        if (clause) {
          for (const c of children(clause)) {
            if (c.type === 'identifier') names.push(c.text);
            else if (c.type === 'namespace_import') names.push(children(c)[0]?.text ?? '*');
            else if (c.type === 'named_imports') {
              for (const s of children(c)) {
                const alias = field(s, 'alias') ?? field(s, 'name');
                if (alias) names.push(alias.text);
              }
            }
          }
        }
        if (src) facts.imports.push({ names, source: exprToArg(src, ctx).value });
        return;
      }
      case 'export_statement': {
        const decl = field(node, 'declaration');
        const decs = children(node).filter((c) => c.type === 'decorator');
        if (decl) visitTop(decl, decs, true);
        else {
          const v = field(node, 'value');
          if (v && tsSpec.functionTypes.includes(v.type)) {
            const unit = makeUnit(v, `${file}:default`, 'default', undefined, [], field(v, 'parameters'));
            const fb = field(v, 'body');
            if (fb) collectBody(fb, unit, b);
            facts.units.push(unit);
          } else if (v) {
            moduleParts.push(node.text);
            collectBody(v, moduleUnit, b);
          }
        }
        return;
      }
      case 'decorator':
        pendingDecorators.push(node);
        return;
      case 'class_declaration':
      case 'abstract_class_declaration':
        visitClass(node, pendingDecorators);
        return;
      case 'function_declaration':
      case 'generator_function_declaration': {
        const fname = field(node, 'name')?.text ?? 'fn';
        const unit = makeUnit(node, `${file}:${fname}`, fname, undefined, [], field(node, 'parameters'));
        const fb = field(node, 'body');
        if (fb) collectBody(fb, unit, b);
        facts.units.push(unit);
        return;
      }
      case 'lexical_declaration':
      case 'variable_declaration':
        for (const d of children(node).filter((c) => c.type === 'variable_declarator')) visitDeclarator(d, [], exported);
        return;
      case 'interface_declaration':
      case 'type_alias_declaration':
      case 'enum_declaration':
        return;
      default:
        moduleParts.push(node.text);
        collectBody(node, moduleUnit, b);
    }
  };

  let pending: Node[] = [];
  for (const c of children(root)) {
    if (c.type === 'decorator') {
      pending.push(c);
      continue;
    }
    visitTop(c, pending, false);
    pending = [];
  }
  if (moduleUnit.invocations.length || moduleUnit.anonymousChildren.length) {
    moduleUnit.body = moduleParts.join('\n');
    facts.units.push(moduleUnit);
  }
  tree.delete();
  return facts;
}
