import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { ExtractionIssue, ExtractorConfig, Layer, ServiceInfo, ServiceManifest } from '@codegraph/schema';
import { validateManifest } from '@codegraph/schema';
import { loadConfig, inferService } from './config.js';
import { loadRepo } from './repo.js';
import { assembleManifest, createContext, runPlugins } from './build.js';

export interface ExtractOptions {
  /** Path to codegraph.yaml; defaults to <repo>/codegraph.yaml. */
  configPath?: string;
  /** Inline config merged over the file config. */
  config?: ExtractorConfig;
  serviceId?: string;
  layer?: Layer;
  verbose?: boolean;
  /** Record the git commit in the manifest (default true). */
  includeCommit?: boolean;
  /** Keep every code unit instead of only those on entry->effect paths. */
  noPrune?: boolean;
}

export interface ExtractResult {
  manifest: ServiceManifest;
  plugins: string[];
  stats: { files: number; units: number; types: number };
}

const execFileP = promisify(execFile);

async function gitCommit(repoRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { timeout: 5000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function extract(repoPath: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  const repoRoot = path.resolve(repoPath);
  const fileConfig = await loadConfig(repoRoot, options.configPath);
  const config: ExtractorConfig = { ...fileConfig, ...options.config, service: { ...fileConfig.service, ...options.config?.service } };
  const issues: ExtractionIssue[] = [];
  const repo = await loadRepo(repoRoot, { include: config.include, exclude: config.exclude, verbose: options.verbose }, issues);
  const overrides: Partial<ServiceInfo> = {};
  if (options.serviceId) overrides.id = options.serviceId;
  if (options.layer) overrides.layer = options.layer;
  const service = inferService(repoRoot, repo, config, overrides);
  const ctx = createContext(repo, config, issues);
  const plugins = runPlugins(ctx, options.verbose);
  const commit = options.includeCommit === false ? undefined : await gitCommit(repoRoot);
  const manifest = assembleManifest(ctx, service, { commit, prune: !options.noPrune });
  const errors = validateManifest(manifest);
  if (errors.length) {
    throw new Error('extractor produced an invalid manifest:\n' + errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'));
  }
  return { manifest, plugins, stats: { files: repo.files.length, units: repo.units.length, types: repo.types.size } };
}

export { loadRepo } from './repo.js';
export { loadConfig, inferService, inferLayer, inferFrameworks, slugify } from './config.js';
export { ALL_PLUGINS } from './plugins/index.js';
export type { Plugin, PluginContext } from './plugins/types.js';
export type * from './model.js';
