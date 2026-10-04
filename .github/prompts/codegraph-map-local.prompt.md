---
name: codegraph-map-local
description: Map a folder of application repositories with code-graph and open the viewer (runs Phase 0 and Phase 2 of AGENTS.md)
agent: agent
tools: ['codebase', 'search', 'editFiles', 'runCommands']
argument-hint: APPS=<folder containing your repos> OUT=<output folder>
---
Follow `AGENTS.md` in this repository exactly.

Inputs: ${input}. If APPS or OUT is missing, ask for it before running anything.

1. Run Phase 0 (build the tools). Stop and report if any "Expect" check fails.
2. Run Phase 2 (map the user's repositories) end to end, including writing `codegraph.yaml` files for unresolved calls, re-running until clean, and starting the viewer.
3. Finish with the Phase 2 step 8 report and the viewer URL.

Do not run Phase 1, 3 or 4 unless asked.
