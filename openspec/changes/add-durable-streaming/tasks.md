## 1. watchScript

- [x] 1.1 Read pi-durable 1.1.0's `watchEvents`, `TaskGraphWatch` and `ProgressPolicy`, and pick the checkpoint subscription (`design.md` decision 2), recording the choice in `design.md`. `packages/agent/src/durable/watch.ts`: `watchScript` with history on attach, the checkpoint diff, step, action and run events, and `stop()` (decisions 1, 2, 4, 5), exported from `src/durable/index.ts`. Tests in `__tests__/durable/watch.test.ts` on memory storage with the faux provider: "Scenario: A durable run watched from the start reports every step", "Scenario: Attaching mid-run replays the finished steps", "Scenario: Attaching after the end yields the history", "Scenario: Two watchers see the same events", "Scenario: stop leaves the run running", "Scenario: A watched run with and without a watcher ends the same". `__tests__/package/layers.test.ts` still passes (no `node:` in `src/durable`)
- [x] 1.2 Live deltas and tool events from the step conversation (decisions 3 and 6). In `__tests__/durable/watch.test.ts`: "Scenario: A step's deltas join to its text" (with a throttled `partialIntervalMs`), "Scenario: A tool step reports its call and result", plus one run on node SQLite storage

## 2. Docs

- [x] 2.1 `packages/agent/README.md` durable section and `docs/llm/durable.md`: a `watchScript` example, history on attach, coarser deltas, library-only. `openspec/parked.md`: an SSE route on `defineAgentHost` built on `watchScript`, and watching across processes. `CLAUDE.md`'s `src/durable` row names `watch.ts`. Run `pnpm docs:check`, `pnpm check`, `pnpm test`, and watch one durable run live on Ollama (`qwen3.5:latest`), recording it in `design.md` under "Verified live"

The change ends with `pnpm change close add-durable-streaming`.
