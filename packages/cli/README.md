# @codegraph/cli

One command to map a whole estate from a developer machine, without CI or a catalog repo.

```
codegraph scan <root>... [options]     Extract every repo under the roots, aggregate, write graph + docs
codegraph serve [options]              Serve the explorer UI for an existing graph.json
codegraph open <root>... [options]     scan, then serve and open the browser
```

```bash
npx @codegraph/cli open ~/src                      # every git repo (or codegraph.yaml) up to 2 levels deep
npx @codegraph/cli scan ~/src/orders-* --out ./codegraph-out --config ./codegraph.aggregate.yaml
npx @codegraph/cli serve --graph ./codegraph-out/graph.json --port 4173
```

`scan` runs the extractor in-process per repo (a repo without `codegraph.yaml` still works: id, layer and language are inferred), writes `manifests/<id>.json`, `graph.json` and `docs/` under `--out`, and prints every warning with its code and location. Repos that fail to parse are reported and skipped; the rest still aggregate.

`serve` is a tiny static server for the published explorer bundle (`@codegraph/ui/dist`) with `graph.json` mounted at `/graph.json`. Nothing leaves the machine.

Options: `--depth`, `--configured-only`, `--config`, `--traces`, `--enrichment`, `--no-docs`, `--graph`, `--port`, `--verbose`.
