import type { Graph } from '@codegraph/schema';
import { sampleGraph } from '../fixtures/sample-graph';

export type LoadState =
  | { status: 'loading' }
  | { status: 'empty'; reason: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; graph: Graph; source: string };

export function isGraph(v: unknown): v is Graph {
  if (!v || typeof v !== 'object') return false;
  const g = v as Partial<Graph>;
  return Array.isArray(g.nodes) && Array.isArray(g.edges) && Array.isArray(g.flows) && Array.isArray(g.issues);
}

export async function loadInitialGraph(): Promise<LoadState> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1') return { status: 'ready', graph: sampleGraph, source: 'demo fixture' };
  // Relative to the page so the site can live under any path; ?graph=<url> overrides.
  const url = params.get('graph') ?? 'graph.json';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return { status: 'empty', reason: `No graph found at ${url}` };
    if (!res.ok) return { status: 'error', message: `${res.status} ${res.statusText} loading ${url}` };
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // Vite dev server serves index.html for unknown paths; treat as missing.
      return { status: 'empty', reason: `No graph found at ${url}` };
    }
    if (!isGraph(json)) return { status: 'error', message: `${url} is not a graph.json (missing nodes/edges/flows/issues)` };
    return { status: 'ready', graph: json, source: url };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export function readGraphFile(file: File): Promise<Graph> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        if (!isGraph(json)) throw new Error('File is not a graph.json');
        resolve(json);
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsText(file);
  });
}
