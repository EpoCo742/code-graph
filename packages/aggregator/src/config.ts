import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export interface ExternalDecl {
  name?: string;
  description?: string;
  owner?: string;
  tags?: string[];
}

/** `codegraph.aggregate.yaml` */
export interface AggregateConfig {
  /**
   * Resolution map. Keys are matched (case-insensitively) against an HttpCall's
   * targetHint, its URL host, or a regex when wrapped in slashes (/.../).
   * Values are service ids. Use "external:<host>" to declare an external system.
   */
  targets?: Record<string, string>;
  /** Extra metadata for external systems keyed by host or external id. */
  externals?: Record<string, ExternalDecl>;
  /** Map of trace service names to manifest service ids. */
  traceServiceMap?: Record<string, string>;
  flows?: {
    /** Maximum cross-service depth when deriving flows. Default 8. */
    maxDepth?: number;
    /** Also derive flows for endpoints called by other services (not only roots). Default false. */
    includeNonRoots?: boolean;
  };
  /** Services to ignore entirely. */
  ignoreServices?: string[];
}

export function loadAggregateConfig(path?: string): AggregateConfig {
  if (!path) return {};
  if (!existsSync(path)) throw new Error(`Config not found: ${path}`);
  const text = readFileSync(path, 'utf8');
  const parsed = path.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
  return (parsed ?? {}) as AggregateConfig;
}
