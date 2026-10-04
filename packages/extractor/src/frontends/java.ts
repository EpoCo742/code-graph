import type { Node } from 'web-tree-sitter';
import { children, endLine, field, line, parse } from '../parser.js';
import type { Attr, CodeUnit, FileFacts, TypeFacts } from '../model.js';
import { collectBody, makeAttr, paramsOf, stringValue, type ExprContext, type LangSpec, type UnitBuilder } from './common.js';

export const javaSpec: LangSpec = {
  stringTypes: ['string_literal', 'text_block'],
  templateTypes: [],
  templateSubstitution: '',
  stringContent: ['string_fragment', 'multiline_string_fragment'],
  identifier: ['identifier'],
  memberTypes: [['field_access', 'object', 'field']],
  invocationType: 'method_invocation',
  invocation: { objectField: 'object', nameField: 'name', argumentsField: 'arguments', typeArgsField: 'type_arguments' },
  functionTypes: ['lambda_expression'],
  functionBodyField: 'body',
  arrayTypes: ['array_initializer', 'element_value_array_initializer'],
  binaryType: 'binary_expression',
  newTypes: [{ type: 'object_creation_expression', typeField: 'type' }],
  transparent: ['parenthesized_expression', 'cast_expression'],
};

const TYPE_DECLS = ['class_declaration', 'interface_declaration', 'record_declaration', 'enum_declaration'];

function annotationsOf(node: Node, ctx: ExprContext): Attr[] {
  const out: Attr[] = [];
  const mods = children(node).find((c) => c.type === 'modifiers');
  if (!mods) return out;
  for (const a of children(mods)) {
    if (a.type === 'marker_annotation' || a.type === 'annotation') {
      const name = field(a, 'name')?.text ?? '';
      out.push(makeAttr(name.split('.').pop()!, field(a, 'arguments'), javaSpec, ctx));
    }
  }
  return out;
}

export async function parseJava(file: string, source: string): Promise<FileFacts> {
  const tree = await parse('java', source);
  const root = tree.rootNode;
  const facts: FileFacts = { path: file, language: 'java', imports: [], types: [], units: [], constants: {}, variables: {}, refs: {} };
  const b: UnitBuilder = { file, spec: javaSpec, units: facts.units, anonCounter: 0 };
  const ctx: ExprContext = { spec: javaSpec, file, onFunction: () => '' };

  const visitType = (node: Node) => {
    const name = field(node, 'name')?.text ?? 'Anonymous';
    const t: TypeFacts = {
      name,
      file,
      line: line(node),
      isInterface: node.type === 'interface_declaration',
      attrs: annotationsOf(node, ctx),
      baseTypes: [],
      fields: [],
      ctorParams: [],
      methods: [],
      constants: {},
    };
    const sup = children(node).find((c) => c.type === 'superclass');
    if (sup) t.baseTypes.push(...children(sup).map((c) => c.text));
    const ifaces = children(node).find((c) => c.type === 'super_interfaces' || c.type === 'extends_interfaces');
    if (ifaces) {
      const list = children(ifaces).find((c) => c.type === 'type_list');
      if (list) t.baseTypes.push(...children(list).map((c) => c.text));
    }
    const rp = field(node, 'parameters');
    if (rp) t.ctorParams = paramsOf(rp, javaSpec);
    const body = field(node, 'body');
    if (body) {
      for (const m of children(body)) {
        if (m.type === 'field_declaration') {
          const type = field(m, 'type')?.text;
          const attrs = annotationsOf(m, ctx);
          for (const d of children(m).filter((c) => c.type === 'variable_declarator')) {
            const fname = field(d, 'name')?.text;
            if (!fname) continue;
            t.fields.push({ name: fname, type, attrs: attrs.length ? attrs : undefined });
            const v = field(d, 'value');
            if (v && javaSpec.stringTypes.includes(v.type)) t.constants[fname] = stringValue(v, javaSpec);
          }
        } else if (m.type === 'constructor_declaration') {
          t.ctorParams.push(...paramsOf(field(m, 'parameters'), javaSpec));
          const unit = makeUnit(m, `${name}.<init>`, `${name}.<init>`, name, []);
          const cb = field(m, 'body');
          if (cb) collectBody(cb, unit, b);
          facts.units.push(unit);
          t.methods.push(unit.id);
        } else if (m.type === 'method_declaration') {
          const mname = field(m, 'name')?.text ?? 'method';
          const unit = makeUnit(m, `${name}.${mname}`, `${name}.${mname}`, name, annotationsOf(m, ctx));
          const mb = field(m, 'body');
          if (mb) collectBody(mb, unit, b);
          else unit.isAbstract = true;
          facts.units.push(unit);
          t.methods.push(unit.id);
        } else if (TYPE_DECLS.includes(m.type)) {
          visitType(m);
        }
      }
    }
    facts.types.push(t);
  };

  const makeUnit = (node: Node, id: string, name: string, typeName: string, attrs: Attr[]): CodeUnit => ({
    id,
    name,
    typeName,
    file,
    line: line(node),
    endLine: endLine(node),
    attrs,
    params: paramsOf(field(node, 'parameters'), javaSpec),
    body: node.text,
    invocations: [],
    strings: [],
    anonymousChildren: [],
  });

  for (const c of children(root)) {
    if (c.type === 'import_declaration') {
      const q = children(c).find((k) => k.type === 'scoped_identifier' || k.type === 'identifier');
      if (q) facts.imports.push({ names: [q.text.split('.').pop()!], source: q.text });
    } else if (TYPE_DECLS.includes(c.type)) visitType(c);
  }
  tree.delete();
  return facts;
}
