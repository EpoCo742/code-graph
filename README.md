# code-graph

A map of how your applications call each other: which UI calls which API, which API calls which, and which services talk through Kafka or RabbitMQ. Generated from source code, nothing hand-drawn.

## Start here: the whole idea in three stages

Each stage produces one file. That is the entire model.

```
  your repo(s)          manifest.json (one per app)         graph.json             website
 ┌────────────┐ extract ┌───────────────────────────┐ aggregate ┌──────────┐ view ┌─────────┐
 │ source code│ ──────► │ endpoints, outbound calls, │ ────────► │ all apps │ ───► │ explore │
 │            │         │ messages sent/received     │           │ joined   │      │         │
 └────────────┘         └───────────────────────────┘           └──────────┘      └─────────┘
```

1. **Extract** reads one repo's code and writes a small `manifest.json` for that app.
2. **Aggregate** reads a folder of manifests and writes one `graph.json`.
3. **View** is a website that reads `graph.json`.

Everything else in this repo (CI workflows, AI naming, trace import, PCF deployment) only automates or enriches these three stages. You do not need any of it to get started.

## See it work in five commands (sample apps included)

Needs Node 22 or newer. Run in this folder:

```
npm install
npm run build
npm run extract:samples        # samples/*  →  out/manifests/*.json
npm run aggregate:samples      # out/manifests  →  out/graph.json
node packages/cli/dist/cli.js serve --graph out/graph.json
```

Open http://127.0.0.1:4173. You are looking at the ten fake apps in `samples/`: a web UI, two experience APIs, one capability API, four domain APIs, two message processors, plus three external vendors. Try the Flows tab and pick "Storefront Web UI: placeOrder".

![Service map](docs/screenshots/service-map.png)

## Run it on your own apps in one command

Clone the repos you care about side by side in one folder, for example `C:\work\apps\orders-api`, `C:\work\apps\inventory-api`, and so on. Then:

```
node packages/cli/dist/cli.js open C:\work\apps
```

This finds every repo in the folder, extracts each one, aggregates them, writes everything to `codegraph-out\`, and opens the browser. No configuration is required for a first look. Supported today: C# (ASP.NET Core), Java (Spring), TypeScript and JavaScript (Express, NestJS, React/fetch/axios), with Kafka and RabbitMQ.

Two things will happen on real code:

- **Some calls will be "unresolved."** The extractor saw an HTTP call but could not tell which service it goes to, usually because the URL comes from a config key. The Issues tab lists each one with file and line. To fix one, add a `codegraph.yaml` at that repo's root with a mapping, then re-run:

  ```yaml
  service:
    id: orders-api          # name used in the graph
    layer: capability       # ui | experience | capability | domain | processor
  targets:
    "Services:Inventory:BaseUrl": inventory-api     # config key  → service id
    INVENTORY_URL: inventory-api                    # env var     → service id
    api.stripe.com: external:stripe                 # host        → external system
  ```

  A full example of this file is in `templates/app-repo/codegraph.yaml`. If you use Copilot in VS Code, the prompt `/codegraph-onboard` (from `templates/app-repo/.github/prompts/`) writes it for you.

- **Layers are guessed from names.** A repo named `*-ui` lands in the UI lane, `*-experience-api` or `*-bff` in Experience, `*-capability-*` in Capability, `*-domain-*` in Domain, `*-worker` or `*-processor` in Processors. Set `layer:` in `codegraph.yaml` when the guess is wrong.

## What is in this repo

| Folder | What it is |
|---|---|
| `packages/extractor` | Stage 1. Static analysis built on tree-sitter. |
| `packages/aggregator` | Stage 2. Joins manifests, resolves who calls whom, derives end-to-end flows, writes docs. |
| `packages/ui` | Stage 3. The explorer website (React). |
| `packages/cli` | The `codegraph` command that runs the stages together (`scan`, `serve`, `open`, `package`). |
| `packages/schema` | The shape of `manifest.json` and `graph.json`. |
| `packages/enrich` | Optional. Uses GitHub Copilot or Claude to name flows and summarise handlers. |
| `samples/` | Ten fake apps used by tests and the demo above. |
| `templates/` | Files to copy into your repos when you automate (part 2 below). |

---

# Part 2: Automating it for the whole organisation

Everything above runs on one machine by hand. This part makes it run by itself: every repo publishes its own manifest on merge, a central repo rebuilds the graph, and the website is redeployed. Set it up once you have seen value from part 1.

## Rolling it out in your organisation

Do these once, in order.

### Step 1: Publish the tooling (platform team, once)

1. Push this repo to GitHub under your org, for example `your-org/code-graph`.
2. Run `node scripts/set-scope.mjs your-org` so packages are named `@your-org/extractor` and so on (GitHub Packages requires the scope to equal the org). Commit the result.
3. Tag a release: `git tag v0.1.0 && git push --tags`. The `release` workflow publishes all packages to GitHub Packages. The `ci` workflow builds, tests and runs the sample pipeline on every PR.

### Step 2: Create the catalog repo (platform team, once)

1. Create `your-org/codegraph-catalog` and copy everything from `templates/catalog-repo/` into it.
2. Edit `codegraph.aggregate.yaml` for cross-cutting rules (external vendors, trace service-name mappings). Per-service mappings belong in each app's `codegraph.yaml`, not here.
3. Enable GitHub Pages with source "GitHub Actions" in the repo settings.
4. Optional secrets: `COPILOT_GITHUB_TOKEN` (a token with Copilot access; enables AI enrichment on your Copilot seats) or `ANTHROPIC_API_KEY`. Optional `CODEGRAPH_READ_TOKEN` with read access to app repos if you want handler summaries, plus a `repos.txt` listing them. Without any of these the graph and docs still build; flows keep their structural names.
5. Optional: export your tracing backend's service dependencies into `traces/service-graph.json` (Jaeger `/api/dependencies` shape, or `[{source,target}]`). This confirms static edges and surfaces calls to systems outside your domain.

### Step 3: Onboard each application repo (app teams, ~15 minutes per repo)

1. Copy `templates/app-repo/.npmrc`, `templates/app-repo/.github/` and `templates/app-repo/codegraph.yaml` into the repo.
2. In VS Code with Copilot, run the prompt `/codegraph-onboard`. It fills in `codegraph.yaml` (service id, layer, owner, and a `targets` entry for every outbound call it finds), runs the extractor, and reports anything unresolved. Review and commit. Without Copilot, fill the file by hand following `.github/instructions/codegraph.instructions.md` and run `npx @your-org/extractor . --out manifest.json --verbose`.
3. Add the repo secret `CODEGRAPH_CATALOG_TOKEN` (fine-grained PAT or GitHub App token with contents:write on the catalog repo) and the repo variable `CODEGRAPH_CATALOG_REPO=your-org/codegraph-catalog`.
4. Merge. From now on every push to `main` publishes `manifests/<service-id>.json` to the catalog, and every pull request gets a sticky comment listing added or removed endpoints, consumers, outbound calls and publishes.

### Step 4: Keep it accurate (ongoing)

- When a PR comment or the explorer's Issues view shows `call:unresolved`, run `/codegraph-resolve` in Copilot. It traces the URL to its config key and adds the `targets` entry with evidence.
- Dependencies that code cannot reveal (shared SDKs, sidecars) go in `declaredDependencies` with a reason.
- The catalog site rebuilds on every manifest change and weekly, so trace drift and enrichment stay current.
- To add a framework or language, add a plugin in `packages/extractor/src/plugins/` or a frontend in `src/frontends/`, extend the samples, and add a test.

## Deploying the explorer (PCF, Pages, or any static host)

The explorer is a static single-page app with no backend. At startup it fetches one file, `graph.json`, from the folder it was served from (or from `?graph=<url>` if given), builds an in-memory model, and renders everything client-side. So a deployment is just a folder: the built bundle plus `graph.json`, optionally with the generated docs under `/docs`.

`codegraph package` assembles that folder and adds what Cloud Foundry needs:

```bash
npm run build                                # once; builds the explorer bundle
npm run extract:samples && npm run aggregate:samples
node packages/cli/dist/cli.js package --graph out/graph.json --docs-dir out/docs --site site --app-name codegraph-explorer
cf push -f site/manifest.yml -p site         # staticfile buildpack, 64M, rolling deploy
```

What ends up in `site/`:

| File | Purpose |
|---|---|
| `index.html`, `assets/` | The explorer bundle, built with a relative base so it works at any route or sub-path. |
| `graph.json` | The aggregated graph. Served with `Cache-Control: no-store` so users always see the latest deploy. |
| `docs/` | Optional Markdown + Mermaid docs for download. |
| `manifest.yml` | Cloud Foundry app manifest: `staticfile_buildpack`, memory, instances, app name. |
| `Staticfile`, `nginx/conf/includes/codegraph.conf` | Buildpack config: HTTPS redirect, no directory listing, cache headers. |
| `Staticfile.auth` | Only with `--htpasswd <file>`: basic auth for the whole site (generate the file with `htpasswd -nb user pass`). |

Keeping it current: the catalog workflow (`templates/catalog-repo/.github/workflows/codegraph-site.yml`) already runs `codegraph package` after every aggregation and uploads the folder as an artifact. Its `pcf` job pushes the folder with the CF CLI whenever these are configured on the catalog repo: secrets `CF_API`, `CF_USERNAME`, `CF_PASSWORD` (use a service account), variables `CF_ORG`, `CF_SPACE`, and optionally `CF_APP_NAME` and secret `CODEGRAPH_HTPASSWD`. Every manifest change then produces a fresh `graph.json` and a rolling redeploy with zero downtime. The same job can target GitHub Pages instead, or both.

If you prefer the data to update without redeploying the app, host `graph.json` elsewhere (a bucket, an internal file server) and link to the explorer with `?graph=https://.../graph.json`. The page fetches it with `no-store`, so the host needs CORS to allow the explorer's origin.

## How the pieces fit

- **Manifests are the asset.** Small, reviewable JSON, produced by CI from the code that owns it. Everything else is derived and can be regenerated.
- **Resolution is layered.** `codegraph.yaml` targets beat catalog config beat hint matching beat path matching. Every edge carries `resolution` and `confidence`; every miss becomes an issue with a file and line.
- **Flows are structural first.** The aggregator follows the handler call graph through resolved calls and topic subscriptions without any model. AI adds names and prose, so the graph is correct with enrichment off.
- **AI cost is bounded.** Inputs are manifest facts plus handler source slices, never files or repos. Results are cached by handler hash, so a one-method change re-sends one method. With Copilot there is no extra vendor bill; with Anthropic the Batch API halves the price.
- **Traces are ground truth.** Static edges seen in traces become `both`; trace-only edges become `observed` and are flagged as drift; static edges never observed are listed too.

## Limitations

- Static detection is pattern based. Dynamic routing, URLs built far from the call site, and unusual client wrappers surface as `call:unresolved` issues rather than guesses.
- Python, Go, Kotlin and gRPC are not supported yet. The plugin shape makes them additive.
- The trace importer works at service granularity. Span-level import would allow endpoint-level observed edges.
- The extractor prunes handlers that are neither entry points nor on a path to an outbound effect; pass `--no-prune` to keep them.
