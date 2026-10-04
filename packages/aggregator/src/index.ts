import type { Graph, ServiceManifest } from '@codegraph/schema';
import { buildGraph, finalizeGraph } from './build.js';
import { loadAggregateConfig, type AggregateConfig } from './config.js';
import { applyFlowEnrichment, applyServiceEnrichment, loadEnrichment } from './enrich-merge.js';
import { deriveFlows } from './flows.js';
import { loadManifests } from './load.js';
import { mergeTraces, parseTraceFile, type ObservedEdge } from './traces.js';

export interface AggregateOptions {
  config?: AggregateConfig;
  observed?: ObservedEdge[];
  enrichmentDir?: string;
}

/** Programmatic entry point: manifests in, graph out. */
export function aggregate(manifests: ServiceManifest[], options: AggregateOptions = {}): Graph {
  const config = options.config ?? {};
  const enrichment = loadEnrichment(options.enrichmentDir);
  const copies = manifests.map((m) => structuredClone(m));
  applyServiceEnrichment(copies, enrichment.services);
  const ctx = buildGraph(copies, config);
  if (options.observed?.length) mergeTraces(ctx, options.observed);
  const flows = deriveFlows(ctx);
  applyFlowEnrichment(flows, enrichment.flows);
  return finalizeGraph(ctx, flows);
}

export { buildGraph, finalizeGraph, deriveFlows, loadManifests, loadAggregateConfig, mergeTraces, parseTraceFile };
export { writeDocs, serviceMapMermaid, flowSequenceMermaid } from './docs.js';
export type { AggregateConfig, ObservedEdge };
export { diffManifests, diffToMarkdown } from './diff.js';
export type { ManifestDiff } from './diff.js';
