import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Content-addressed JSON cache: unchanged inputs cost zero tokens on the next run. */
export class JsonCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  key(parts: unknown[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
  }

  get<T>(key: string): T | undefined {
    const p = join(this.dir, `${key}.json`);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown) {
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value));
  }
}
