import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest, type ServiceManifest } from '@codegraph/schema';

export interface LoadedManifest {
  file: string;
  manifest: ServiceManifest;
}

/** Load every *.json manifest from the given files/directories. Throws on invalid manifests. */
export function loadManifests(inputs: string[]): LoadedManifest[] {
  const files: string[] = [];
  for (const input of inputs) {
    const st = statSync(input);
    if (st.isDirectory()) {
      for (const name of readdirSync(input).sort()) {
        if (name.endsWith('.json') && !name.endsWith('.enrich.json')) files.push(join(input, name));
      }
    } else files.push(input);
  }
  const out: LoadedManifest[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const errors = validateManifest(data);
    if (errors.length) {
      throw new Error(`${file} is not a valid manifest:\n` + errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'));
    }
    const m = data as ServiceManifest;
    const prev = seen.get(m.service.id);
    if (prev) throw new Error(`Duplicate service id "${m.service.id}" in ${prev} and ${file}`);
    seen.set(m.service.id, file);
    out.push({ file, manifest: m });
  }
  return out;
}
