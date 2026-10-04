# Agent runbook for code-graph

This file is written for an AI coding agent (GitHub Copilot, Claude Code, Cursor) to execute. Follow the phases in order. Every command is run from a shell whose working directory is this repository root unless a step says otherwise. After every command, compare the result with the "Expect" line; if it does not match, stop and report the full output instead of continuing.

Terms used below:
- TOOLS = the absolute path of this repository (contains `package.json`, `packages/`, `samples/`).
- APPS = an absolute path to a folder that contains the user's application repositories side by side (each subfolder is one git repo).
- OUT = an absolute path to an empty or non-existent folder where outputs will be written.

Ask the user for APPS and OUT if they were not given. Do not guess them.

---

## Phase 0: Build the tools (once per machine)

1. Verify Node is 22.12 or newer.
   Command: `node --version`
   Expect: prints `v22.12.0` or higher. If lower, stop and tell the user to install Node 24 LTS.
2. Install dependencies.
   Command: `npm install`
   Expect: exit code 0. Warnings about `install-scripts` are normal and can be ignored.
3. Build every package.
   Command: `npm run build`
   Expect: exit code 0, last lines include `✓ built`. Verify the files `packages/cli/dist/cli.js`, `packages/extractor/dist/cli.js`, `packages/aggregator/dist/cli.js`, and `packages/ui/dist/index.html` exist.
4. Run the tests.
   Command: `npm test`
   Expect: five summaries, every one with `fail 0`.

## Phase 1: Prove the pipeline on the bundled sample apps

The sample apps live in `samples/`. Outputs go to `out/` inside TOOLS.

1. Command: `npm run extract:samples`
   Expect: last line `wrote 10/10 manifests to out\manifests` (or `out/manifests`). Verify `out/manifests/` now holds 10 `.json` files, including `orders-capability-api.json`.
2. Command: `npm run aggregate:samples`
   Expect: a line starting `Graph: 13 services, 20 endpoints, 4 topics, 12 http edges, 7 flows`. Verify `out/graph.json` exists and `out/docs/index.md` exists. Exactly one `[warn] drift:observed-only` line is expected; it is a deliberate sample.
3. Start the viewer.
   Command: `node packages/cli/dist/cli.js serve --graph out/graph.json --port 4173`
   Expect: prints `explorer: http://127.0.0.1:4173/`. The process keeps running; run it in the background or a second terminal.
4. Verify the viewer serves data.
   Command: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/graph.json`
   Expect: `200`.
5. Tell the user to open http://127.0.0.1:4173/ and to click the Flows tab, then "Storefront Web UI: placeOrder". Stop the server afterwards (Ctrl+C or kill the process listening on 4173).

## Phase 2: Map the user's own repositories (local, no CI)

Preconditions: Phase 0 done. APPS exists and contains at least one git repository as a direct child folder. Supported languages: C# (ASP.NET Core), Java (Spring), TypeScript/JavaScript (Express, NestJS, React with fetch/axios); Kafka and RabbitMQ.

1. List what will be scanned.
   Command: `node packages/cli/dist/cli.js scan "APPS" --out "OUT" --no-docs --verbose`
   (Replace APPS and OUT with the real paths. Keep the quotes.)
   Expect: a line `found N repositories`, then one line per repository with counts of endpoints, consumers, calls and publishes, then a line starting `graph:`. Lines starting with `!` mean a repository failed to parse; report them but continue.
2. Verify outputs.
   Expect: `OUT/manifests/` contains one `.json` per repository; `OUT/graph.json` exists.
3. Collect unresolved calls.
   Command (PowerShell): `Get-Content "OUT/graph.json" | ConvertFrom-Json | Select-Object -ExpandProperty issues | Where-Object code -eq "call:unresolved" | Format-List service, message, location`
   Command (bash): `node -e "const g=require('OUT/graph.json');for(const i of g.issues.filter(i=>i.code==='call:unresolved'))console.log(i.service,'|',i.message,'|',i.location?.file+':'+i.location?.line)"`
   Expect: a list, possibly empty. Each entry names a service, a URL with a hint in parentheses, and a file:line.
4. For each unresolved call, decide the target service and write a mapping:
   a. Open the file at the reported file:line inside that repository under APPS.
   b. Find where the base URL or client comes from: a config key (for example `Services:Customers:BaseUrl`), an environment variable (`CUSTOMERS_URL`), a named client (`CreateClient("customers")`, `@FeignClient(name="customers")`), or a literal host.
   c. Decide which repository under APPS that points to. Use the `service.id` values printed in step 1 (they are the repository folder names unless a `codegraph.yaml` overrides them). A third-party host (stripe.com, sendgrid.com) maps to `external:<vendor>`.
   d. Create or edit `codegraph.yaml` in that repository's root:
      ```yaml
      service:
        id: <this repo's service id>
        layer: <ui | experience | capability | domain | processor>
      targets:
        "<the exact hint from the issue>": <target service id or external:name>
      ```
      Keep existing entries. The key must be the hint text exactly as reported (including colons), quoted.
   e. If the destination is genuinely dynamic (computed from data at runtime), leave it and note it in the report.
5. Re-run step 1 and step 3 until the unresolved list is empty or only contains the dynamic cases from 4e.
6. Fix wrong layers. In step 1's output, each service id is followed by its guessed layer in the graph. If a repository landed in the wrong swimlane, set `layer:` in its `codegraph.yaml` and re-run step 1.
7. Produce the final outputs with docs and start the viewer.
   Commands:
   `node packages/cli/dist/cli.js scan "APPS" --out "OUT"`
   `node packages/cli/dist/cli.js serve --graph "OUT/graph.json" --port 4173`
   Expect: `explorer: http://127.0.0.1:4173/`. Tell the user to open it.
8. Report: number of repositories mapped, number of endpoints and edges from the `graph:` line, the mappings added to each `codegraph.yaml`, and any repositories that failed to parse or calls left unresolved.

## Phase 3: Package the viewer for deployment (optional)

Preconditions: Phase 2 (or Phase 1) produced a `graph.json`.

1. Command: `node packages/cli/dist/cli.js package --graph "OUT/graph.json" --docs-dir "OUT/docs" --site "OUT/site" --app-name codegraph-explorer`
   Expect: prints the site path. `OUT/site/` contains `index.html`, `assets/`, `graph.json`, `manifest.yml`, `Staticfile`.
2. That folder is a complete static website. For Cloud Foundry / PCF: `cf push -f "OUT/site/manifest.yml" -p "OUT/site"`. For any other static host, upload the folder as-is. For basic auth, add `--htpasswd <file>` to step 1.

## Phase 4: Automate across the organisation with GitHub Actions (optional, do after Phase 2 works)

This replaces the local APPS folder with GitHub. Each application repository analyses itself on merge and sends its manifest to one shared "catalog" repository, which rebuilds the graph and redeploys the viewer. Requires GitHub, npm, and permission to create repositories and secrets.

1. Publish the tools so repositories can run them with `npx`:
   a. In TOOLS, command: `node scripts/set-scope.mjs <github-org-name>` then `npm install` then commit. (GitHub Packages requires the npm scope to equal the org name.)
   b. Command: `git tag v0.1.0 && git push --tags`
   Expect: the `release` workflow in `.github/workflows/release.yml` publishes `@<org>/extractor`, `@<org>/aggregator`, `@<org>/enrich`, `@<org>/ui`, `@<org>/cli` to GitHub Packages.
2. Create the catalog repository:
   a. Create a new private GitHub repository named `codegraph-catalog`.
   b. Copy everything from `TOOLS/templates/catalog-repo/` into its root (including the hidden `.github/` folder) and commit.
   c. In the catalog repository settings, enable GitHub Pages with source "GitHub Actions" if Pages deployment is wanted. For PCF, add secrets `CF_API`, `CF_USERNAME`, `CF_PASSWORD` and variables `CF_ORG`, `CF_SPACE`.
   d. Copy each `codegraph.yaml` written in Phase 2 into its application repository (not into the catalog). Cross-cutting rules only go in the catalog's `codegraph.aggregate.yaml`.
3. For each application repository:
   a. Copy `TOOLS/templates/app-repo/.github/workflows/codegraph.yml` to `.github/workflows/codegraph.yml` in that repository.
   b. Copy `TOOLS/templates/app-repo/.npmrc` to the repository root.
   c. Optionally copy `TOOLS/templates/app-repo/.github/prompts/` and `.github/instructions/` so Copilot users get `/codegraph-onboard` and `/codegraph-resolve`.
   d. Add repository secret `CODEGRAPH_CATALOG_TOKEN` (a fine-grained token with contents: write on `codegraph-catalog`) and repository variable `CODEGRAPH_CATALOG_REPO` = `<org>/codegraph-catalog`.
   e. Merge. Expect: the `codegraph` workflow runs, uploads `manifest.json` as an artifact, and on pushes to main commits `manifests/<service-id>.json` into the catalog repository. On pull requests it only comments with the manifest diff.
4. Verify end to end: after the first app manifest lands in the catalog, the `codegraph-site` workflow in the catalog runs and the Pages URL (or PCF route) shows the viewer with that app. Each further onboarded repository appears automatically.

---

## Reference: what each file is

| File | Produced by | Consumed by | Contents |
|---|---|---|---|
| `codegraph.yaml` (in an app repo) | a human or `/codegraph-onboard` | extractor | service id, layer, owner, and `targets` mapping config keys / env vars / client names / hosts to service ids |
| `manifests/<id>.json` | extractor (Phase 1/2 step 1, or each app's CI) | aggregator | that app's endpoints, consumers, outbound calls with hints, publishes, handler call graph |
| `graph.json` | aggregator | viewer, `package`, docs | all services, endpoints, topics, resolved edges, derived flows, issues |
| `docs/` | aggregator | humans | Markdown + Mermaid per service and per flow |
| `site/` | `codegraph package` | PCF / static host | viewer bundle + graph.json + manifest.yml |
| `codegraph.aggregate.yaml` (catalog) | a human | aggregator | cross-cutting target rules, external system names, trace service-name map |
| `traces/service-graph.json` (catalog, optional) | exported from Jaeger/Tempo/APM | aggregator | observed service-to-service calls; confirms edges and flags drift |
