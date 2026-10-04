---
name: codegraph-resolve
description: Fix unresolved outbound calls reported by codegraph by adding targets to codegraph.yaml
agent: agent
tools: ['codebase', 'search', 'editFiles', 'runCommands']
argument-hint: paste the call:unresolved issue lines (or leave empty to run the extractor)
---
Resolve codegraph `call:unresolved` issues for this repository.

Input: ${input}

If no issues were pasted, run `npx --yes @codegraph/extractor . --out /tmp/manifest.json` and read the `issues` array in the output file.

For each unresolved call:
1. Open the file and line from the issue's `location`. Trace how the URL or client is constructed: follow the base URL back to its configuration key, environment variable, named client registration (`AddHttpClient("name", ...)`, `@FeignClient(name=...)`, `axios.create({ baseURL })`), or options class.
2. Decide the destination service. Use appsettings*.json, application*.yml, .env*, Helm/Kubernetes manifests, or docker-compose files in the repo to find the real host, and map it to a service id using the convention `<domain>-<layer>-api`. Third-party hosts map to `external:<vendor>`.
3. Add a `targets` entry to `codegraph.yaml` keyed by the exact hint the extractor reported (config key, env var, client name or host). Add a short comment with the evidence (file and line).
4. Re-run the extractor and confirm the issue is gone.

Do not edit application code. If a call is truly dynamic (destination computed at runtime from data), leave it, and explain why in a comment above `targets`.

Finish with a table: hint → service id → evidence.
