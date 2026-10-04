# code-graph

Monorepo (npm workspaces, Node 24, TypeScript ESM) that maps application flows across many services.

- `packages/schema`: the contract. `ServiceManifest` is what one repo emits; `Graph` is what the aggregator produces. Change types here first, then rebuild (`npm run build -w @codegraph/schema`) before touching dependants.
- `packages/extractor`: tree-sitter (web-tree-sitter + official grammar wasm) static analysis. Language frontends produce generic code units; framework plugins in `src/plugins/*` turn units into endpoints, consumers, calls and publishes. Add a framework by adding a plugin file, never by special-casing a frontend.
- `packages/aggregator`: resolves call targets (`src/build.ts`, order: declared → config → hint → host → literal → path), derives flows structurally (`src/flows.ts`), merges traces, writes docs, and diffs manifests (`src/diff.ts`).
- `packages/enrich`: AI summaries and flow names through a `Provider` (`src/provider.ts`: Anthropic SDK or GitHub Copilot SDK). Sends handler slices only, caches by handler hash. Never send whole files or repos.
- `packages/ui`: Vite + React + React Flow explorer that loads `public/graph.json`.
- `samples/`: ten fake services used by tests and the demo. Keep them parseable; they are not built.

Commands: `npm ci`, `npm run build`, `npm test`, `npm run extract:samples`, `npm run aggregate:samples`, `npm run ui:dev`.

Conventions: ESM with `.js` import suffixes, `node --test` tests compiled from `src/*.test.ts`, no new runtime dependencies without a reason in the PR. Manifest and graph ids are stable strings used across repos; do not change id formats without a schema version bump.
