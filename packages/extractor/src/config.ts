import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { ExtractorConfig, Layer, ServiceInfo } from '@codegraph/schema';
import { LAYERS } from '@codegraph/schema';
import type { RepoFacts } from './model.js';

export async function loadConfig(repoRoot: string, explicit?: string): Promise<ExtractorConfig> {
  const candidates = explicit ? [explicit] : ['codegraph.yaml', 'codegraph.yml', 'codegraph.json'].map((f) => path.join(repoRoot, f));
  for (const c of candidates) {
    try {
      const text = await fs.readFile(c, 'utf8');
      const parsed = c.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
      return (parsed ?? {}) as ExtractorConfig;
    } catch (e) {
      if (explicit) throw new Error(`cannot read config ${c}: ${(e as Error).message}`);
    }
  }
  return {};
}

export function slugify(s: string): string {
  return s
    .replace(/^@[^/]+\//, '')
    .replace(/\.(csproj|Api|Web|Service|App|Worker)$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function inferLayer(name: string): Layer {
  const n = name.toLowerCase();
  if (/(^|[-_.])(ui|web|frontend|spa|portal|app)([-_.]|$)/.test(n)) return 'ui';
  if (/(^|[-_.])(experience|exp|bff|gateway)([-_.]|$)/.test(n)) return 'experience';
  if (/(^|[-_.])(capability|cap)([-_.]|$)/.test(n)) return 'capability';
  if (/(^|[-_.])(domain|core)([-_.]|$)/.test(n)) return 'domain';
  if (/(^|[-_.])(processor|worker|consumer|handler|listener|job|daemon)([-_.]|$)/.test(n)) return 'processor';
  return 'unknown';
}

function inferName(repoRoot: string, facts: RepoFacts): string | undefined {
  for (const pf of facts.packageFiles) {
    const base = path.basename(pf.path);
    if (base === 'package.json') {
      try {
        const name = (JSON.parse(pf.content) as { name?: string }).name;
        if (name) return name;
      } catch {
        /* ignore */
      }
    } else if (base.endsWith('.csproj')) {
      return base.replace(/\.csproj$/, '');
    } else if (base === 'pom.xml') {
      const ids = [...pf.content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1].trim());
      // first artifactId after <parent> block ends, else first
      const parentEnd = pf.content.indexOf('</parent>');
      const own = ids.find((id) => pf.content.indexOf(`<artifactId>${id}</artifactId>`) > parentEnd);
      if (own ?? ids[0]) return own ?? ids[0];
    }
  }
  return path.basename(repoRoot);
}

export function inferFrameworks(facts: RepoFacts): string[] {
  const deps = facts.dependencies;
  const has = (re: RegExp) => [...deps].some((d) => re.test(d));
  const fw: string[] = [];
  if (has(/^Microsoft\.NET\.Sdk\.Web$/) || has(/^Microsoft\.AspNetCore/) || has(/^Swashbuckle/)) fw.push('aspnetcore');
  if (has(/spring-boot-starter-web/) || has(/spring-webmvc/)) fw.push('spring');
  if (has(/spring-cloud-starter-openfeign/)) fw.push('feign');
  if (has(/spring-kafka/) || has(/^Confluent\.Kafka$/) || has(/^kafkajs$/)) fw.push('kafka');
  if (has(/spring-rabbit|spring-boot-starter-amqp/) || has(/^RabbitMQ\.Client$/) || has(/^amqplib$/)) fw.push('rabbitmq');
  if (has(/^MassTransit/)) fw.push('masstransit');
  if (has(/^express$/)) fw.push('express');
  if (has(/^fastify$/)) fw.push('fastify');
  if (has(/^koa$/)) fw.push('koa');
  if (has(/^@nestjs\/core$/)) fw.push('nestjs');
  if (has(/^react$/)) fw.push('react');
  if (has(/^@angular\/core$/)) fw.push('angular');
  if (has(/^vue$/)) fw.push('vue');
  if (has(/^axios$/)) fw.push('axios');
  if (has(/^Refit$/)) fw.push('refit');
  return fw;
}

export function inferService(repoRoot: string, facts: RepoFacts, config: ExtractorConfig, overrides: Partial<ServiceInfo>): ServiceInfo {
  const cfg = config.service ?? {};
  const inferredName = inferName(repoRoot, facts) ?? path.basename(repoRoot);
  const id = overrides.id ?? cfg.id ?? slugify(inferredName);
  const name = overrides.name ?? cfg.name ?? inferredName;
  const layerCandidate = overrides.layer ?? cfg.layer ?? inferLayer(id);
  const layer = LAYERS.includes(layerCandidate) ? layerCandidate : 'unknown';
  const langs = [...facts.languages];
  const language = cfg.language ?? (langs.length === 1 ? langs[0] : langs.sort((a, b) => count(facts, b) - count(facts, a))[0]);
  const frameworks = cfg.frameworks ?? inferFrameworks(facts);
  return {
    id,
    name,
    layer,
    owner: cfg.owner,
    repo: cfg.repo,
    language,
    frameworks: frameworks.length ? frameworks : undefined,
    description: cfg.description,
    tags: cfg.tags,
  };
}

function count(facts: RepoFacts, lang: string): number {
  return facts.files.filter((f) => f.language === lang).length;
}
