## Why

`add-run-streaming` gives a one-shot run live events. A durable run, the kind a long-lived host such as a server, a Durable Object or a task runner uses, still offers only `waitForScript`, which resolves when the run ends. pi-durable already publishes each conversation's agent events (`watchEvents`: message deltas and tool execution) and the task graph's changes (`watchTaskGraph`). Each Agent Script step is its own child conversation, recorded in the run's checkpoint, so the pieces are there to stream a durable run in the same `RunEvent` vocabulary. This is library-only, like the one-shot change.

## What Changes

- `watchScript(harness, id, context)` in `./durable` returns the same shape as `streamRun`: an async iterable of `RunEvent`s and a `result` promise that settles like `waitForScript`. It adds `stop()` to detach without affecting the run.
- A watcher attached to a run already in progress first gets `step_start` and `step_end` for every step already applied, with no deltas. Then the in-flight step's text so far arrives as one `text_delta`, followed by live deltas. A watcher of a finished run gets the history and `run_end`.
- The live events come from pi-durable:
  - message changes on the step's conversation become `text_delta` and `thinking_delta`;
  - tool executions become `tool_call` and `tool_result`;
  - the run's checkpoint moving between phases gives `step_start`, `step_end`, `action_start`, `action_end` and `run_end`.
- Deltas arrive at pi-durable's commit pace (its `partialIntervalMs`). They are coarser than a one-shot stream, but a step watched from its start still joins to its final text.
- Watching never changes the run. Several watchers may attach at once, and a watcher whose reader is slow loses nothing.

## Out of scope

- **The CLIs.** `agentscript-durable`, `-task` and `-change` print what they print today.
- **A streaming route on the Cloudflare host,** such as SSE from `defineAgentHost`. A host can build one on `watchScript`, and it is parked.
- **Watching from a process that doesn't run the harness.** pi-durable's events are in-process. Watching a run another process owns is a storage-level question for later.
- **Task-loop and spec-loop events.** The task loop already has its JSON Lines events, and loops are not runs.

## Capabilities

- **Modified:** `durable/host`.

## Impact

- `packages/agent/src/durable/watch.ts` (new): `watchScript`, exported from `./durable`. Runtime-neutral (no `node:`), so a Durable Object can use it.
- It may need the run checkpoint's step conversation ID to be readable, which it already is in the `await` phase (`extension.ts`). There is no change to stored state, so existing databases resume unchanged.
- Tests in `__tests__/durable/watch.test.ts` on memory and node SQLite storage with pi's faux provider.
- `packages/agent/README.md` (durable section) and `docs/llm/durable.md`: a `watchScript` example, and that streaming is library-only.
