import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Flow, ServiceManifest } from '@codegraph/schema';

/**
 * Enrichment file produced by @codegraph/enrich: `<service-id>.enrich.json`.
 * Everything is optional and keyed by ids from the manifest / graph.
 */
export interface ServiceEnrichment {
  service?: string;
  description?: string;
  handlers?: Record<string, { summary: string; hash?: string }>;
  endpoints?: Record<string, { summary: string; useCase?: string }>;
}

/** `flows.enrich.json`: keyed by flow id. */
export interface FlowEnrichment {
  flows?: Record<string, { name?: string; useCase?: string; description?: string; steps?: Record<number, string> }>;
}

export function loadEnrichment(dir?: string): { services: Map<string, ServiceEnrichment>; flows: FlowEnrichment } {
  const services = new Map<string, ServiceEnrichment>();
  let flows: FlowEnrichment = {};
  if (!dir || !existsSync(dir)) return { services, flows };
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.enrich.json')) continue;
    const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (name === 'flows.enrich.json') flows = data as FlowEnrichment;
    else services.set(data.service ?? name.replace(/\.enrich\.json$/, ''), data as ServiceEnrichment);
  }
  return { services, flows };
}

/** Apply enrichment to manifests in place (before graph build) so summaries flow into nodes. */
export function applyServiceEnrichment(manifests: ServiceManifest[], enrich: Map<string, ServiceEnrichment>) {
  for (const m of manifests) {
    const e = enrich.get(m.service.id);
    if (!e) continue;
    if (e.description && !m.service.description) m.service.description = e.description;
    for (const h of m.handlers) {
      const he = e.handlers?.[h.id];
      // Only apply when the hash still matches (or no hash recorded) so stale summaries are dropped.
      if (he && (!he.hash || !h.hash || he.hash === h.hash)) h.summary = he.summary;
    }
    for (const ep of m.endpoints) {
      const ee = e.endpoints?.[ep.id];
      if (ee) ep.summary = ee.summary;
    }
  }
}

export function applyFlowEnrichment(flows: Flow[], enrich: FlowEnrichment) {
  for (const f of flows) {
    const fe = enrich.flows?.[f.id];
    if (!fe) continue;
    if (fe.name) f.name = fe.name;
    if (fe.useCase) f.useCase = fe.useCase;
    if (fe.description) f.description = fe.description;
    if (fe.steps) for (const [i, d] of Object.entries(fe.steps)) if (f.steps[+i]) f.steps[+i].description = d;
  }
}
