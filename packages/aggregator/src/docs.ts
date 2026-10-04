import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EndpointNode, Flow, Graph, GraphEdge, ServiceNode, TopicNode } from '@codegraph/schema';

/** Write Markdown + Mermaid documentation for the whole graph. */
export function writeDocs(graph: Graph, dir: string) {
  mkdirSync(join(dir, 'services'), { recursive: true });
  mkdirSync(join(dir, 'flows'), { recursive: true });
  const services = graph.nodes.filter((n): n is ServiceNode => n.kind === 'service');
  const topics = graph.nodes.filter((n): n is TopicNode => n.kind === 'topic');
  const endpoints = graph.nodes.filter((n): n is EndpointNode => n.kind === 'endpoint');
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // index.md
  const layers = ['ui', 'experience', 'capability', 'domain', 'processor', 'external', 'unknown'];
  let idx = `# Application flow map\n\nGenerated ${graph.generatedAt}\n\n`;
  idx += `| Metric | Count |\n|---|---|\n| Services | ${services.length} |\n| Endpoints | ${endpoints.length} |\n| Topics | ${topics.length} |\n| Flows | ${graph.flows.length} |\n| Issues | ${graph.issues.length} |\n\n`;
  idx += `## Service map\n\n\`\`\`mermaid\n${serviceMapMermaid(graph)}\`\`\`\n\n`;
  for (const layer of layers) {
    const inLayer = services.filter((s) => s.layer === layer);
    if (!inLayer.length) continue;
    idx += `## ${cap(layer)}\n\n| Service | Owner | Endpoints | Consumers | Calls | Publishes |\n|---|---|---|---|---|---|\n`;
    for (const s of inLayer) idx += `| [${s.name}](services/${s.id}.md) | ${s.owner ?? ''} | ${s.stats.endpoints} | ${s.stats.consumers} | ${s.stats.calls} | ${s.stats.publishes} |\n`;
    idx += '\n';
  }
  idx += `## Flows\n\n| Flow | Use case | Entry | Steps | Services |\n|---|---|---|---|---|\n`;
  for (const f of graph.flows) {
    const svcs = new Set(f.steps.map((s) => s.service));
    idx += `| [${f.name}](flows/${f.id}.md) | ${f.useCase ?? ''} | ${f.entry.service} | ${f.steps.length} | ${svcs.size} |\n`;
  }
  idx += `\n## Issues\n\n| Level | Code | Service | Message |\n|---|---|---|---|\n`;
  for (const i of graph.issues) idx += `| ${i.level} | ${i.code} | ${i.service ?? ''} | ${esc(i.message)}${i.location ? ` (${i.location.file}:${i.location.line})` : ''} |\n`;
  writeFileSync(join(dir, 'index.md'), idx);
  writeFileSync(join(dir, 'service-map.mmd'), serviceMapMermaid(graph));

  // services/<id>.md
  for (const s of services) {
    let md = `# ${s.name}\n\n`;
    md += `- **Id**: \`${s.id}\`\n- **Layer**: ${s.layer}\n`;
    if (s.owner) md += `- **Owner**: ${s.owner}\n`;
    if (s.repo) md += `- **Repo**: ${s.repo}\n`;
    if (s.language) md += `- **Language**: ${s.language}${s.frameworks?.length ? ` (${s.frameworks.join(', ')})` : ''}\n`;
    if (s.description) md += `\n${s.description}\n`;
    const eps = endpoints.filter((e) => e.service === s.id);
    if (eps.length) {
      md += `\n## Endpoints\n\n| Method | Path | Handler | Summary |\n|---|---|---|---|\n`;
      for (const e of eps) md += `| ${e.method} | \`${e.path}\` | ${e.handler} | ${e.summary ?? ''} |\n`;
    }
    const consumes = graph.edges.filter((e) => e.kind === 'consume' && e.target === s.id);
    if (consumes.length) {
      md += `\n## Consumes\n\n| Topic | Broker | Routing key / group | Handler |\n|---|---|---|---|\n`;
      for (const e of consumes) { const t = byId.get(e.source) as TopicNode; md += `| ${t.name} | ${t.broker} | ${e.routingKey ?? ''} | ${e.fromHandler?.split('#')[1] ?? ''} |\n`; }
    }
    const calls = graph.edges.filter((e) => e.kind === 'http-detail' && e.source.startsWith(s.id + '#'));
    if (calls.length) {
      md += `\n## Outbound HTTP calls\n\n| From handler | Method | URL | Target | Resolution | Confidence |\n|---|---|---|---|---|---|\n`;
      for (const e of calls) {
        const target = e.endpoint ? `${(byId.get(e.endpoint) as EndpointNode).service} \`${(byId.get(e.endpoint) as EndpointNode).method} ${(byId.get(e.endpoint) as EndpointNode).path}\`` : e.target;
        md += `| ${e.fromHandler?.split('#')[1]} | ${e.method ?? ''} | \`${esc(e.url ?? '')}\` | ${target} | ${e.resolution} | ${e.confidence.toFixed(2)} |\n`;
      }
    }
    const pubs = graph.edges.filter((e) => e.kind === 'publish' && e.source === s.id);
    if (pubs.length) {
      md += `\n## Publishes\n\n| Topic | Broker | Routing key | From handler |\n|---|---|---|---|\n`;
      for (const e of pubs) { const t = byId.get(e.target) as TopicNode; md += `| ${t.name} | ${t.broker} | ${e.routingKey ?? ''} | ${e.fromHandler?.split('#')[1] ?? ''} |\n`; }
    }
    const callers = graph.edges.filter((e) => e.kind === 'http' && e.target === s.id);
    if (callers.length) md += `\n## Called by\n\n${callers.map((e) => `- ${e.source} (${e.status})`).join('\n')}\n`;
    const issues = graph.issues.filter((i) => i.service === s.id);
    if (issues.length) md += `\n## Issues\n\n${issues.map((i) => `- **${i.level}** ${i.code}: ${i.message}${i.location ? ` (${i.location.file}:${i.location.line})` : ''}`).join('\n')}\n`;
    writeFileSync(join(dir, 'services', `${s.id}.md`), md);
  }

  // flows/<id>.md
  for (const f of graph.flows) {
    let md = `# ${f.name}\n\n`;
    if (f.useCase) md += `**Use case:** ${f.useCase}\n\n`;
    if (f.description) md += `${f.description}\n\n`;
    md += `Entry: \`${f.entry.service}\` ${f.entry.kind} \`${f.entry.ref.split('#').pop()}\`\n\n`;
    md += `\`\`\`mermaid\n${flowSequenceMermaid(graph, f)}\`\`\`\n\n## Steps\n\n`;
    f.steps.forEach((s, i) => { md += `${i + 1}. **${s.service}** ${s.kind} — ${s.description ?? s.ref}\n`; });
    writeFileSync(join(dir, 'flows', `${f.id}.md`), md);
  }
}

export function serviceMapMermaid(graph: Graph): string {
  const services = graph.nodes.filter((n): n is ServiceNode => n.kind === 'service');
  const topics = graph.nodes.filter((n): n is TopicNode => n.kind === 'topic');
  const layers = ['ui', 'experience', 'capability', 'domain', 'processor', 'external', 'unknown'];
  let s = 'flowchart LR\n';
  for (const layer of layers) {
    const inLayer = services.filter((x) => x.layer === layer);
    if (!inLayer.length) continue;
    s += `  subgraph ${layer}\n`;
    for (const n of inLayer) s += `    ${mid(n.id)}["${esc(n.name)}"]\n`;
    s += '  end\n';
  }
  for (const t of topics) s += `  ${mid(t.id)}>"${esc(t.broker)}: ${esc(t.name)}"]\n`;
  for (const e of graph.edges) {
    if (e.kind === 'http' || e.kind === 'declared') s += `  ${mid(e.source)} ${e.status === 'observed' ? '-.->' : '-->'} ${mid(e.target)}\n`;
    else if (e.kind === 'publish') s += `  ${mid(e.source)} -.-> ${mid(e.target)}\n`;
    else if (e.kind === 'consume') s += `  ${mid(e.source)} -.-> ${mid(e.target)}\n`;
  }
  return s;
}

export function flowSequenceMermaid(graph: Graph, f: Flow): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const participants: string[] = [];
  const add = (id: string) => { if (!participants.includes(id)) participants.push(id); };
  add(f.entry.service);
  for (const st of f.steps) add(st.kind === 'publish' ? st.ref : st.service);
  let s = 'sequenceDiagram\n';
  for (const p of participants) {
    const n = byId.get(p);
    const label = n?.kind === 'topic' ? `${n.broker}:${n.name}` : n?.kind === 'service' ? n.name : p;
    s += `  participant ${mid(p)} as ${esc(label)}\n`;
  }
  for (let i = 0; i < f.steps.length; i++) {
    const st = f.steps[i];
    if (i === 0) { s += `  Note over ${mid(st.service)}: ${esc(st.description ?? st.ref)}
`; continue; }
    const from = st.from ?? f.entry.service;
    if (st.kind === 'publish') s += `  ${mid(st.service)}-)${mid(st.ref)}: ${esc(st.description ?? 'publish')}
`;
    else if (st.kind === 'consumer') s += `  ${mid(from)}-)${mid(st.service)}: ${esc(st.description ?? 'consume')}
`;
    else s += `  ${mid(from)}->>${mid(st.service)}: ${esc(st.description ?? st.ref)}
`;
  }
  return s;
}

const mid = (id: string) => 'n_' + id.replace(/[^A-Za-z0-9]/g, '_');
const esc = (s: string) => s.replace(/"/g, "'").replace(/\|/g, '/').replace(/[\r\n]+/g, ' ');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type { GraphEdge };
