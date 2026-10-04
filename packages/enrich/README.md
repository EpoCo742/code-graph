# @codegraph/enrich

AI enrichment for the graph: handler and endpoint summaries, service descriptions, and business names for flows. Designed so that whole repositories never enter the model's context and unchanged code costs nothing on re-runs.

```
codegraph-enrich <manifests-dir> --repos <dir> --out <dir> [options]

  --graph <file>           graph.json from the aggregator; enables flow naming
  --out <dir>              Where *.enrich.json files are written (default: ./enrichment)
  --cache <dir>            Cache directory (default: .codegraph-cache/enrich)
  --repo <id>=<path>       Explicit repo path for a service (repeatable)
  --only <id,id>           Limit to these service ids
  --model-summaries <id>   Model for handler/endpoint summaries (default: claude-sonnet-5-5)
  --model-flows <id>       Model for flow naming (default: claude-opus-5-5)
  --batch                  Send summaries through the Message Batches API (50% cheaper, async)
  --dry-run                Print what would be sent and rough token counts without calling the API
  --skip-flows             Do not name flows
```

Authentication: `ANTHROPIC_API_KEY`, or a profile from `ant auth login`.

## What keeps it cheap

- **Only interesting handlers are sent**: endpoint handlers, message consumers, and anything that transitively reaches an outbound call or publish. Plumbing is skipped.
- **Source slices, not files**: each handler's body is cut by line range from the manifest's locations. No repository is ever read whole.
- **Content-hash cache**: results are stored per handler keyed by the handler's body hash, model and prompt version. Re-running after a one-method change re-sends that one method.
- **Prompt caching**: the system prompt is byte-stable and marked `cache_control: ephemeral`, so repeated requests pay the cached rate for it.
- **Batch API**: `--batch` sends all summary requests as one Message Batch at half price, suited to CI.
- **Two models**: bulk summaries default to Sonnet 5.5; the much smaller flow-naming step, which reasons across services, defaults to Opus 5.5. Both are flags.
- **Structured outputs**: responses are validated against a Zod schema, so no retries for malformed JSON.

Use `--dry-run` first to see how many requests and roughly how many tokens a run will cost.

## Output

- `<out>/<service-id>.enrich.json` – `{ service, description, handlers: {id: {summary, hash}}, endpoints: {id: {summary, useCase}} }`
- `<out>/flows.enrich.json` – `{ flows: {id: {name, useCase, description}} }`

Feed the directory back into the aggregator with `--enrichment <out>`. Handler summaries whose hash no longer matches the manifest are dropped automatically, so stale text never ships.
