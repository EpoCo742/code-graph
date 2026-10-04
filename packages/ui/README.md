# @codegraph/ui

Interactive explorer for the aggregated service graph (`graph.json`). Vite + React 18 + React Flow, with ELK for automatic swimlane layout. No UI kit; hand-written CSS with light and dark themes.

## Run

```sh
npm run dev -w @codegraph/ui      # http://localhost:5173
npm run build -w @codegraph/ui    # type-check + production bundle in dist/
npm run preview -w @codegraph/ui
```

From the repo root, `npm run ui:dev` does the same.

## Where graph.json comes from

The page fetches `/graph.json` on load. The aggregator writes it there:

```sh
node packages/aggregator/dist/cli.js out/manifests \
  --config samples/codegraph.aggregate.yaml \
  --traces samples/codegraph.traces.json \
  --out out/graph.json \
  --copy-to packages/ui/public/graph.json
```

`packages/ui/public/graph.json` is git-ignored. Without it the app shows an empty state with the commands to run. You can also:

- drag and drop any `graph.json` onto the page, or use the **Load…** button;
- append `?graph=<url>` to load a graph from another location;
- append `?demo=1` to load the built-in fixture (`src/fixtures/sample-graph.ts`), useful when working on the UI without the extractor.

## Views

| View | What it shows |
| --- | --- |
| **Service map** | Services as nodes in swimlanes by layer (UI → Experience → Capability → Domain → Processors → External). Topics are pill nodes between publishers and consumers. HTTP edges are solid, messaging edges dashed, trace-only edges dotted, low-confidence edges faint. Click a node to highlight its neighbourhood, drag the upstream/downstream sliders in the side panel for blast radius, double-click (or **Focus**) to show only that subgraph. |
| **Side panel** | For a service: owner, repo, language, frameworks, tags, who calls it, then tabs for Endpoints, Consumers, Calls, Publishes, Flows, Issues. Clicking an endpoint shows the handlers it reaches and the outbound calls/publishes they make. For a topic: publishers and consumers. For an edge: method, URL, endpoint, handler, resolution, confidence, source location. |
| **Endpoints** | Sortable, searchable table of every endpoint. Click a row to open its flow (when one exists) or focus the map on its service. |
| **Flows** | List of use cases. Selecting one shows a hand-rolled SVG sequence diagram (lifelines per service/topic, numbered arrows), the service-map subgraph for that flow with the path numbered, and the step list. |
| **Issues** | Table of aggregation/extraction issues with level and code filters. |

The stats strip above the map counts services, endpoints, topics, edges, unresolved edges and flows.

## Filters and URL state

Everything that changes what you see lives in the URL hash so a view can be shared:

| Param | Meaning |
| --- | --- |
| `view` | `map` (default), `endpoints`, `flows`, `issues` |
| `sel` | Selected node or edge id |
| `ep` | Selected endpoint id inside the side panel |
| `flow` | Selected flow id |
| `q` | Search text |
| `layers`, `owners`, `kinds`, `statuses` | Comma-separated filter chips |
| `hideExt`, `hideTopics` | `1` to hide external services / collapse topics into direct service edges |
| `up`, `down` | Blast-radius hops (default 1) |
| `focus` | `1` to show only the selected node's blast radius |

Keyboard: `/` focuses search, `Esc` clears the selection (or the search text when the search box is focused).

Theme follows `prefers-color-scheme`; the toggle in the top bar overrides it and is remembered in `localStorage`.

## Source links

When a service has a `repo` URL on GitHub, GitLab or Azure DevOps, `file:line` locations in the side panel link to the file in the repository (best effort, `HEAD` branch).

## Structure

```
src/
  model/GraphModel.ts   indexes over graph.json, traversal, endpoint impact
  model/flowDerive.ts   turns a Flow into lifelines + arrows + map subset
  model/loadGraph.ts    fetch / drop / demo loading
  state/useHashState.ts URL-hash state
  layout/layout.ts      ELK layered layout with layer partitions + lanes
  components/           React Flow node/edge/lane components
  views/                ServiceMap, DetailPanel, EndpointsView, FlowsView, SequenceDiagram, IssuesView
  fixtures/             demo graph
```

ELK is loaded with a dynamic import so the main bundle stays small; the layout chunk loads on first map render.
