import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServiceManifest } from '@codegraph/schema';
import { JsonCache } from './cache.js';
import { sliceHandlers } from './slice.js';
import { buildServicePrompt, interestingHandlers, planService } from './summaries.js';

const loc = (line: number) => ({ file: 'src/a.ts', line });
const m: ServiceManifest = {
  schemaVersion: '1',
  generatedAt: '2026-01-01T00:00:00Z',
  service: { id: 'svc', name: 'Svc', layer: 'capability' },
  handlers: [
    { id: 'C.create', kind: 'http', name: 'C.create', location: loc(1), calls: ['S.place'], hash: 'h1' },
    { id: 'S.place', kind: 'service', name: 'S.place', location: loc(5), calls: ['S.helper'], hash: 'h2' },
    { id: 'S.helper', kind: 'service', name: 'S.helper', location: loc(9), calls: [], hash: 'h3' },
    { id: 'S.unused', kind: 'service', name: 'S.unused', location: loc(12), calls: [], hash: 'h4' },
  ],
  endpoints: [{ id: 'POST /x', method: 'POST', path: '/x', handler: 'C.create', location: loc(1) }],
  consumers: [],
  calls: [{ id: 'c', method: 'GET', url: '{b}/y', fromHandler: 'S.helper', location: loc(10) }],
  publishes: [],
};
const src = `class C {\n  create() {\n    return s.place();\n  }\n  place() {\n    return this.helper();\n  }\n\n  helper() {\n    return fetch(b + '/y');\n  }\n  unused() {}\n}\n`;

test('interesting handlers include endpoint handlers and anything reaching an effect', () => {
  const ids = interestingHandlers(m);
  assert.deepEqual([...ids].sort(), ['C.create', 'S.helper', 'S.place']);
});

test('slices cut handlers by line range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), src);
  const slices = sliceHandlers(dir, m, new Set(['S.place', 'S.helper']));
  assert.equal(slices.length, 2);
  assert.ok(slices[0].text.includes('place()'));
  assert.ok(!slices[0].text.includes('fetch('));
  const prompt = buildServicePrompt(m, slices);
  assert.ok(prompt.includes('### S.helper'));
  assert.ok(prompt.includes('GET {b}/y'));
});

test('plan uses cache and chunks by size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), src);
  const cache = new JsonCache(join(dir, 'cache'));
  const opts = { model: 'm', cache, maxCharsPerRequest: 40 };
  const p1 = planService(m, dir, opts);
  assert.equal(p1.cached.length, 0);
  assert.ok(p1.chunks.length >= 2, 'small max size forces multiple chunks');
  cache.set(cache.key(['handler', 'v1', 'm', 'svc', 'C.create', 'h1']), { description: 'd', handlers: [{ id: 'C.create', summary: 's' }], endpoints: [] });
  const p2 = planService(m, dir, opts);
  assert.equal(p2.cached.length, 1);
});
