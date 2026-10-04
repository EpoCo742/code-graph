import path from 'node:path';
import type { Node } from 'web-tree-sitter';
import { children, endLine, field, line, parse } from '../parser.js';
import type { Attr, CodeUnit, FileFacts, ImportFact, TypeFacts } from '../model.js';
import { collectBody, exprToArg, makeAttr, paramsOf, parseInvocation, stringValue, type ExprContext, type LangSpec, type UnitBuilder } from './common.js';

export const csharpSpec: LangSpec = {
  stringTypes: ['string_literal', 'verbatim_string_literal', 'raw_string_literal'],
  templateTypes: ['interpolated_string_expression'],
  templateSubstitution: 'interpolation',
  stringContent: ['string_literal_content', 'string_content', 'raw_string_content', 'verbatim_string_literal'],
  identifier: ['identifier'],
  memberTypes: [['member_access_expression', 'expression', 'name']],
  invocationType: 'invocation_expression',
  invocation: { functionField: 'function', argumentsField: 'arguments' },
  functionTypes: ['lambda_expression', 'anonymous_method_expression'],
  functionBodyField: 'body',
  argumentWrapper: { type: 'argument', nameField: 'name' },
  objectType: 'anonymous_object_creation_expression',
  pairType: { type: 'assignment_expression', keyField: 'left', valueField: 'right' },
  arrayTypes: ['array_creation_expression', 'implicit_array_creation_expression', 'initializer_expression', 'collection_expression'],
  binaryType: 'binary_expression',
  newTypes: [{ type: 'object_creation_expression', typeField: 'type' }],
  transparent: ['await_expression', 'parenthesized_expression', 'cast_expression', 'conditional_access_expression', 'postfix_unary_expression', 'as_expression'],
  genericNameType: 'generic_name',
};

const TYPE_DECLS = ['class_declaration', 'interface_declaration', 'record_declaration', 'struct_declaration'];

function attrsOf(node: Node, ctx: ExprContext): Attr[] {
  const out: Attr[] = [];
  for (const al of children(node).filter((c) => c.type === 'attribute_list')) {
    for (const a of children(al).filter((c) => c.type === 'attribute')) {
      const name = field(a, 'name')?.text ?? '';
      const argList = children(a).find((c) => c.type === 'attribute_argument_list') ?? null;
      out.push(makeAttr(name.split('.').pop()!, argList, csharpSpec, ctx));
    }
  }
  return out;
}

export async function parseCSharp(file: string, source: string): Promise<FileFacts> {
  const tree = await parse('csharp', source);
  const root = tree.rootNode;
  const facts: FileFacts = { path: file, language: 'csharp', imports: [], types: [], units: [], constants: {}, variables: {}, refs: {} };
  const b: UnitBuilder = { file, spec: csharpSpec, units: facts.units, anonCounter: 0 };
  const ctx: ExprContext = { spec: csharpSpec, file, onFunction: () => '' };

  const globals: Node[] = [];

  const visitContainer = (node: Node) => {
    for (const c of children(node)) {
      if (c.type === 'using_directive') {
        const q = children(c).find((k) => k.type !== 'modifier');
        if (q) facts.imports.push({ names: [], source: q.text } satisfies ImportFact);
      } else if (c.type === 'namespace_declaration' || c.type === 'file_scoped_namespace_declaration') {
        const body = field(c, 'body');
        visitContainer(body ?? c);
      } else if (TYPE_DECLS.includes(c.type)) {
        visitType(c);
      } else if (c.type === 'global_statement') {
        globals.push(c);
      }
    }
  };

  const visitType = (node: Node) => {
    const name = field(node, 'name')?.text ?? 'Anonymous';
    const t: TypeFacts = {
      name,
      file,
      line: line(node),
      isInterface: node.type === 'interface_declaration',
      attrs: attrsOf(node, ctx),
      baseTypes: [],
      fields: [],
      ctorParams: [],
      methods: [],
      constants: {},
    };
    const bases = children(node).find((c) => c.type === 'base_list');
    if (bases) t.baseTypes = children(bases).map((c) => c.text);
    // record primary constructor
    const primary = field(node, 'parameters');
    if (primary) t.ctorParams = paramsOf(primary, csharpSpec);
    const body = field(node, 'body');
    if (body) {
      for (const m of children(body)) {
        if (m.type === 'field_declaration') {
          const vd = children(m).find((c) => c.type === 'variable_declaration');
          if (!vd) continue;
          const type = field(vd, 'type')?.text;
          for (const d of children(vd).filter((c) => c.type === 'variable_declarator')) {
            const fname = field(d, 'name')?.text;
            if (!fname) continue;
            t.fields.push({ name: fname, type });
            const init = children(d).find((c) => csharpSpec.stringTypes.includes(c.type));
            if (init) t.constants[fname] = stringValue(init, csharpSpec);
          }
        } else if (m.type === 'property_declaration') {
          const pname = field(m, 'name')?.text;
          const ptype = field(m, 'type')?.text;
          if (pname) t.fields.push({ name: pname, type: ptype });
          const init = children(m).find((c) => csharpSpec.stringTypes.includes(c.type));
          if (init && pname) t.constants[pname] = stringValue(init, csharpSpec);
        } else if (m.type === 'constructor_declaration') {
          t.ctorParams.push(...paramsOf(field(m, 'parameters'), csharpSpec));
          const unit = makeUnit(m, `${name}..ctor`, `${name}..ctor`, name, []);
          const cb = field(m, 'body');
          if (cb) collectBody(cb, unit, b);
          facts.units.push(unit);
          t.methods.push(unit.id);
        } else if (m.type === 'method_declaration') {
          const mname = field(m, 'name')?.text ?? 'method';
          const unit = makeUnit(m, `${name}.${mname}`, `${name}.${mname}`, name, attrsOf(m, ctx));
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

  const makeUnit = (node: Node, id: string, name: string, typeName: string | undefined, attrs: Attr[]): CodeUnit => ({
    id,
    name,
    typeName,
    file,
    line: line(node),
    endLine: endLine(node),
    attrs,
    params: paramsOf(field(node, 'parameters'), csharpSpec),
    body: node.text,
    invocations: [],
    strings: [],
    anonymousChildren: [],
  });

  visitContainer(root);

  if (globals.length) {
    const base = path.basename(file);
    const unit: CodeUnit = {
      id: `${file}:<module>`,
      name: `${base} (top-level)`,
      file,
      line: line(globals[0]),
      endLine: endLine(globals[globals.length - 1]),
      attrs: [],
      params: [],
      body: globals.map((g) => g.text).join('\n'),
      invocations: [],
      strings: [],
      isModule: true,
      anonymousChildren: [],
    };
    for (const g of globals) {
      collectBody(g, unit, b);
      // module-level string variables
      const decl = children(g).find((c) => c.type === 'local_declaration_statement');
      const vd = decl && children(decl).find((c) => c.type === 'variable_declaration');
      if (vd) {
        for (const d of children(vd).filter((c) => c.type === 'variable_declarator')) {
          const n = field(d, 'name')?.text;
          const nameNode = field(d, 'name');
          const init = children(d).find((c) => !nameNode || c.id !== nameNode.id);
          if (n && init) {
            const a = exprToArg(init, ctx);
            if (a.kind === 'string') facts.constants[n] = a.value;
            else if (init.type === 'invocation_expression') {
              const inv = parseInvocation(init, ctx);
              if (inv) facts.variables[n] = inv;
            } else facts.refs[n] = init.text;
          }
        }
      }
    }
    facts.units.push(unit);
  }
  tree.delete();
  return facts;
}
