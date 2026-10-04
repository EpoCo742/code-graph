import type { ExtractionIssue, ExtractorConfig, HttpCall, HttpEndpoint, MessageConsumer, MessagePublish, SourceLocation } from '@codegraph/schema';
import type { ArgValue, CodeUnit, RepoFacts } from '../model.js';

export interface SyntheticHandler {
  id: string;
  name: string;
  location: SourceLocation;
  kind: 'http' | 'message' | 'other';
}

export interface PluginContext {
  repo: RepoFacts;
  config: ExtractorConfig;
  endpoints: HttpEndpoint[];
  consumers: MessageConsumer[];
  calls: HttpCall[];
  publishes: MessagePublish[];
  issues: ExtractionIssue[];
  /** Handlers created by plugins when a route handler cannot be mapped to a code unit. */
  syntheticHandlers: SyntheticHandler[];
  /** Units that are API client types (for Handler.kind). */
  clientUnits: Set<string>;

  addEndpoint(e: Omit<HttpEndpoint, 'id'>): void;
  addConsumer(c: Omit<MessageConsumer, 'id'>): void;
  addCall(c: Omit<HttpCall, 'id'>): void;
  addPublish(p: Omit<MessagePublish, 'id'>): void;
  issue(level: ExtractionIssue['level'], code: string, message: string, location?: SourceLocation): void;

  /** Resolve a string-ish argument (literal, template, constant reference) to text. */
  resolveString(arg: ArgValue | undefined, unit: CodeUnit): { value: string; resolved: boolean } | undefined;
  /** Derive a target hint (config key, env var, host, client name) for a URL argument. */
  hintFor(arg: ArgValue | undefined, unit: CodeUnit): string | undefined;
  /** Map a hint to a target service id via config.targets. */
  targetFor(hint: string | undefined): string | undefined;
  loc(unit: CodeUnit, line?: number): SourceLocation;
}

export interface Plugin {
  name: string;
  /** Whether this plugin applies to the repo. Config can force-enable/disable. */
  detect(repo: RepoFacts): boolean;
  apply(ctx: PluginContext): void;
}
