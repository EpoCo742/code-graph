---
applyTo: "codegraph.yaml"
---
# codegraph.yaml

This file configures the codegraph extractor, which maps this service's endpoints, message handlers and outbound calls into the organisation-wide application flow graph.

- `service.id` must be kebab-case and unique across the estate. Do not rename it casually: it is the node id other services' `targets` maps point at.
- `service.layer` is one of `ui`, `experience`, `capability`, `domain`, `processor`, `external`.
- `targets` maps hints found in code to service ids. A hint is a config key (`Services:Orders:BaseUrl`), an environment variable (`ORDERS_URL`), a named HttpClient or Feign client name, or a host. Values are service ids or `external:<name>` for third parties.
- Add a `targets` entry whenever the codegraph PR comment or the flow map shows a `call:unresolved` issue for this repo.
- `declaredDependencies` is for dependencies the code does not reveal (shared SDK packages, sidecars). Give a `reason`.
- Keep comments explaining non-obvious mappings; this file is read by humans and by the aggregator.
