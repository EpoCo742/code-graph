# codegraph catalog

This repository is the central store for codegraph manifests and the home of the published flow map.

```
manifests/<service-id>.json     one per service, pushed by each app repo's codegraph workflow
codegraph.aggregate.yaml        cross-cutting resolution rules
traces/service-graph.json       optional export of observed service calls (Jaeger /api/dependencies shape)
repos.txt                       optional list of owner/name repos to clone for AI source slices
enrichment/                     AI summaries and flow names (generated, committed for reuse)
.codegraph-cache/               content-hash cache (generated, committed so unchanged code is never re-sent)
out/docs/                       generated Markdown + Mermaid docs
```

The `codegraph-site` workflow rebuilds `graph.json`, docs and the explorer UI on every manifest change and deploys to GitHub Pages. Set `COPILOT_GITHUB_TOKEN` (or `ANTHROPIC_API_KEY`) as a secret to enable AI enrichment.

Export traces with, for example:

```bash
curl -s "https://jaeger.internal/api/dependencies?endTs=$(date +%s)000&lookback=604800000" > traces/service-graph.json
```
