import { createRequire } from 'node:module';
import { Parser, Language, type Node, type Tree } from 'web-tree-sitter';
import type { LanguageId } from './model.js';

const require = createRequire(import.meta.url);

const WASM: Record<string, string> = {
  csharp: 'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
  java: 'tree-sitter-java/tree-sitter-java.wasm',
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
};

export type Grammar = 'csharp' | 'java' | 'typescript' | 'tsx' | 'javascript';

let initialised: Promise<void> | undefined;
const languages = new Map<Grammar, Promise<Language>>();

async function load(grammar: Grammar): Promise<Language> {
  initialised ??= Parser.init();
  await initialised;
  let p = languages.get(grammar);
  if (!p) {
    p = Language.load(require.resolve(WASM[grammar]));
    languages.set(grammar, p);
  }
  return p;
}

export function grammarForFile(file: string): Grammar | undefined {
  const lower = file.toLowerCase();
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  return undefined;
}

export function languageForGrammar(g: Grammar): LanguageId {
  if (g === 'tsx') return 'typescript';
  return g;
}

export async function parse(grammar: Grammar, source: string): Promise<Tree> {
  const lang = await load(grammar);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  parser.delete();
  if (!tree) throw new Error('parse returned null');
  return tree;
}

/* ---------- small AST helpers shared by frontends ---------- */

export function field(node: Node, name: string): Node | null {
  return node.childForFieldName(name);
}

export function children(node: Node): Node[] {
  return node.namedChildren.filter((c): c is Node => c !== null);
}

export function childrenOfType(node: Node, ...types: string[]): Node[] {
  return children(node).filter((c) => types.includes(c.type));
}

export function firstOfType(node: Node, ...types: string[]): Node | undefined {
  return children(node).find((c) => types.includes(c.type));
}

/** Depth-first walk. Return false from visit to skip the subtree. */
export function walk(node: Node, visit: (n: Node) => boolean | void): void {
  const stack: Node[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (visit(n) === false) continue;
    const kids = children(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

export function line(node: Node): number {
  return node.startPosition.row + 1;
}

export function endLine(node: Node): number {
  return node.endPosition.row + 1;
}

/** Strip surrounding quotes from a string literal token text. */
export function unquote(text: string): string {
  let t = text.trim();
  if (t.startsWith('$@') || t.startsWith('@$')) t = t.slice(2);
  else if (t.startsWith('$') || t.startsWith('@')) t = t.slice(1);
  if (t.startsWith('"""') && t.endsWith('"""')) return t.slice(3, -3).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('`') && t.endsWith('`')))
    return t.slice(1, -1);
  return t;
}

/** Render an interpolation expression as a short placeholder name. */
export function placeholder(expr: string): string {
  const t = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return `{${t.replace(/^_+/, '')}}`;
  const m = /^(?:this\.)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.exec(t);
  if (m) {
    const parts = m[1].split('.');
    return `{${parts[parts.length - 1].replace(/^_+/, '')}}`;
  }
  // config["Key"] / env.X / process.env.X
  const idx = /\[\s*["']([^"']+)["']\s*\]$/.exec(t);
  if (idx) return `{${idx[1]}}`;
  return '{expr}';
}
