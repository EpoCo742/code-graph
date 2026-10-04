import type { ServiceManifest } from '@codegraph/schema';

export interface ManifestDiff {
  service: string;
  endpoints: { added: string[]; removed: string[] };
  consumers: { added: string[]; removed: string[] };
  calls: { added: string[]; removed: string[] };
  publishes: { added: string[]; removed: string[] };
  handlers: { added: number; removed: number; changed: number };
  hasChanges: boolean;
  /** True when a new outbound dependency (call target or published topic) appeared. */
  newDependencies: boolean;
}

const epKey = (m: ServiceManifest) => m.endpoints.map((e) => `${e.method} ${e.path}`);
const consKey = (m: ServiceManifest) => m.consumers.map((c) => `${c.broker}:${c.exchange ?? c.topic}${c.routingKey ? ` (${c.routingKey})` : ''}`);
const callKey = (m: ServiceManifest) => m.calls.map((c) => `${c.method ?? 'HTTP'} ${c.url}${c.targetService ? ` → ${c.targetService}` : c.targetHint ? ` (${c.targetHint})` : ''}`);
const pubKey = (m: ServiceManifest) => m.publishes.map((p) => `${p.broker}:${p.topic}${p.routingKey ? ` (${p.routingKey})` : ''}`);

function setDiff(before: string[], after: string[]) {
  const b = new Set(before), a = new Set(after);
  return { added: [...a].filter((x) => !b.has(x)).sort(), removed: [...b].filter((x) => !a.has(x)).sort() };
}

/** Compare two manifests of the same service. `before` may be undefined for a brand-new service. */
export function diffManifests(before: ServiceManifest | undefined, after: ServiceManifest): ManifestDiff {
  const empty: ServiceManifest = { ...after, endpoints: [], consumers: [], calls: [], publishes: [], handlers: [] };
  const b = before ?? empty;
  const endpoints = setDiff(epKey(b), epKey(after));
  const consumers = setDiff(consKey(b), consKey(after));
  const calls = setDiff(callKey(b), callKey(after));
  const publishes = setDiff(pubKey(b), pubKey(after));
  const bh = new Map(b.handlers.map((h) => [h.id, h.hash]));
  const ah = new Map(after.handlers.map((h) => [h.id, h.hash]));
  let added = 0, removed = 0, changed = 0;
  for (const [id, hash] of ah) { if (!bh.has(id)) added++; else if (bh.get(id) !== hash) changed++; }
  for (const id of bh.keys()) if (!ah.has(id)) removed++;
  const groups = [endpoints, consumers, calls, publishes];
  return {
    service: after.service.id,
    endpoints, consumers, calls, publishes,
    handlers: { added, removed, changed },
    hasChanges: groups.some((g) => g.added.length || g.removed.length) || added > 0 || removed > 0 || changed > 0,
    newDependencies: calls.added.length > 0 || publishes.added.length > 0,
  };
}

/** Render a diff as Markdown suitable for a pull request comment. */
export function diffToMarkdown(d: ManifestDiff): string {
  const lines: string[] = [`### codegraph: ${d.service}`];
  if (!d.hasChanges) { lines.push('', 'No changes to endpoints, consumers, outbound calls or publishes.'); return lines.join('\n'); }
  const section = (title: string, g: { added: string[]; removed: string[] }) => {
    if (!g.added.length && !g.removed.length) return;
    lines.push('', `**${title}**`);
    for (const x of g.added) lines.push(`- ➕ \`${x}\``);
    for (const x of g.removed) lines.push(`- ➖ \`${x}\``);
  };
  section('Endpoints', d.endpoints);
  section('Message consumers', d.consumers);
  section('Outbound HTTP calls', d.calls);
  section('Publishes', d.publishes);
  lines.push('', `Handlers: ${d.handlers.added} added, ${d.handlers.changed} changed, ${d.handlers.removed} removed.`);
  if (d.newDependencies) lines.push('', '> ⚠️ This change introduces a new outbound dependency. Make sure `codegraph.yaml` `targets` can resolve it, or it will show as unresolved in the flow map.');
  return lines.join('\n');
}
