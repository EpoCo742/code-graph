import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handler, ServiceManifest } from '@codegraph/schema';

export interface Slice {
  handlerId: string;
  file: string;
  startLine: number;
  endLine: number;
  text: string;
}

const MAX_LINES = 120;

/**
 * Cut the source for each handler out of the repo without re-parsing: from the
 * handler's start line to the next handler's start line in the same file (or a
 * brace-balanced end), capped at MAX_LINES. Cheap and good enough for summaries.
 */
export function sliceHandlers(repoPath: string, manifest: ServiceManifest, only?: Set<string>): Slice[] {
  const byFile = new Map<string, Handler[]>();
  for (const h of manifest.handlers) {
    const arr = byFile.get(h.location.file) ?? [];
    arr.push(h);
    byFile.set(h.location.file, arr);
  }
  const out: Slice[] = [];
  for (const [file, handlers] of byFile) {
    const abs = join(repoPath, file);
    if (!existsSync(abs)) continue;
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    handlers.sort((a, b) => a.location.line - b.location.line);
    for (let i = 0; i < handlers.length; i++) {
      const h = handlers[i];
      if (only && !only.has(h.id)) continue;
      const start = Math.max(1, h.location.line);
      const nextStart = handlers[i + 1]?.location.line ?? lines.length + 1;
      let end = Math.min(nextStart - 1, start + MAX_LINES - 1, lines.length);
      end = Math.max(end, braceEnd(lines, start, end));
      const text = lines.slice(start - 1, end).join('\n');
      out.push({ handlerId: h.id, file, startLine: start, endLine: end, text });
    }
  }
  return out;
}

/** Find the line where the brace depth opened at/after `start` returns to zero, within [start, limit]. */
function braceEnd(lines: string[], start: number, limit: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start - 1; i < limit; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) return i + 1;
  }
  return start;
}
