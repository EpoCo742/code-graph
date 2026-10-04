# @codegraph/aggregator

Merges per-service manifests into one `graph.json`, resolves who calls whom, derives end-to-end flows, merges observed edges from tracing, and writes Markdown + Mermaid docs.

```
codegraph-aggregate <manifests-dir|file>... [options]

  --out <file>          Output graph.json (default: graph.json)
  --config <file>       codegraph.aggregate.yaml / .json
  --traces <file>       Observed service graph (Jaeger dependencies / generic [{source,target}])
  --enrichment <dir>    Directory with *.enrich.json produced by codegraph-enrich
  --docs <dir>          Also write Markdown + Mermaid docs to this directory
  --copy-to <file>      Also copy graph.json to this path (e.g. the UI's public folder)
  --fail-on <level>     Exit 1 when issues at this level exist: error | warn
```

## How calls are resolved

Each outbound `HttpCall` in a manifest is matched to a target service in this order. The first hit wins and sets `resolution` and `confidence` on the edge.

| Order | Rule | resolution | confidence |
|---|---|---|---|
| 1 | `call.targetService` set by the extractor (from `codegraph.yaml` targets) | `declared` | 1.0 |
| 2 | `targets` map in the aggregate config matches `targetHint`, URL host, or URL (regex keys allowed as `/.../`) | `config` | 0.95 |
| 3 | Tokens of `targetHint` overlap a service id or name (e.g. hint `inventory` → `inventory-domain-api`) | `hint` | 0.8 |
| 4 | Absolute URL whose host contains a service id | `host-match` | 0.7 |
| 5 | Absolute URL with an unknown host → synthesised external node | `literal-host` | 0.9 |
| 6 | Unique path match against all endpoints in the estate | `path-match` | 0.6–0.7 |
| – | Nothing matched → `call:unresolved` issue, no edge | | |

Endpoint matching adds +0.05 and records the exact endpoint, which is what makes per-endpoint flows possible.

## Config: `codegraph.aggregate.yaml`

```yaml
targets:
  ORDERS_CAP_URL: orders-capability-api        # env var / config key / named client → service id
  "Services:Inventory:BaseUrl": inventory-domain-api
  "/stripe\\.com$/": external:stripe           # regex on hint, host or url
  api.sendgrid.com: external:sendgrid
externals:
  stripe: { name: Stripe, description: Card payments, owner: payments-team }
traceServiceMap:
  orders-cap: orders-capability-api            # trace service name → manifest id
flows:
  maxDepth: 8
  includeNonRoots: false                       # true: a flow for every endpoint, not just entry points
ignoreServices: []
```

## Flows

Flows are derived structurally, without AI: for every entry point (root endpoint, consumer of an externally produced topic, or UI handler that makes calls) the aggregator walks the intra-service handler graph, follows resolved HTTP calls into the target endpoint's handler, and follows publishes into every consumer. Flow names default to `METHOD /path`; `codegraph-enrich` replaces them with business names.

## Traces

`--traces` accepts Jaeger's `/api/dependencies` output or a plain array of `{source, target}`. Matching static edges become `status: both`; trace-only edges are added as `observed` with a `drift:observed-only` warning, and static edges never seen in traces get a `drift:declared-only` info.

## Programmatic use

```ts
import { aggregate, loadManifests } from '@codegraph/aggregator';
const graph = aggregate(loadManifests(['./manifests']).map((l) => l.manifest), { config });
```
