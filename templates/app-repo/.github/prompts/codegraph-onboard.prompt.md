---
name: codegraph-onboard
description: Create or complete codegraph.yaml for this repository by inspecting its code
agent: agent
tools: ['codebase', 'search', 'editFiles', 'runCommands']
---
Onboard this repository to codegraph, the organisation's application flow map.

1. Determine the service identity: read package.json, *.csproj or pom.xml and the README. Propose a kebab-case `service.id`, a display name, the `layer` (ui | experience | capability | domain | processor) based on naming and role, and the owning team if a CODEOWNERS file or README says so.
2. Find every place this service calls another service or system over HTTP: HttpClient / named clients / typed clients / Refit, RestTemplate / WebClient / Feign, fetch / axios / Angular HttpClient. For each, identify the configuration key, environment variable, named client, or literal host that decides the destination.
3. Find message producers and consumers (Kafka, RabbitMQ, SQS, MassTransit) and note topic, queue, exchange and routing key names, including any constants or config keys they come from.
4. Write `codegraph.yaml` at the repository root following the format in `.github/instructions/codegraph.instructions.md`: fill `service`, and add one `targets` entry per hint found in step 2, mapping to the most likely service id (use the naming convention `<domain>-<layer>-api`, or `external:<vendor>` for third parties). Where the destination is unknown, add the key with a `# TODO` comment rather than guessing.
5. Run `npx --yes @codegraph/extractor . --out /tmp/manifest.json --verbose` and paste the summary: counts of endpoints, consumers, calls, publishes, and every `issue`. For each `call:unresolved` issue, add or fix a `targets` entry and re-run until none remain or the remaining ones are genuinely dynamic (explain those in a comment).
6. Report what you created, the mappings you were unsure about, and anything the static extractor missed that a human should add to `declaredDependencies`.
