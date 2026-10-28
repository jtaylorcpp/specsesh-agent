## Context

A durable run is an `agentscript.run` task. Its phases are `next` → `dispatch` → `await` (and `act` for `run` statements). Its checkpoint holds the `RunState` (with `steps`) and, while awaiting, the step's child `conversationId` (`src/durable/extension.ts`). pi-durable 1.1.0 offers:
- `watchEvents(harness, conversationId, context)`, an experimental `AgentEventStream` with a `snapshot` and then `message_update` (`MessageChange`: `text_delta`, `thinking_delta`, …), `tool_execution_start`/`_end` and others;
- `harness.watchTaskGraph(context)`, for task changes;
- `getTask`, for the checkpoint.

`add-run-streaming` defines `RunEvent` and `streamRun`'s iterable-plus-result shape.

## Goals / Non-Goals

**Goals:**
- `RunEvent`s for a durable run, with the same type and the same iterable shape as `streamRun`;
- late attachment gets the history;
- watching never changes the run;
- runtime-neutral.

**Non-Goals:** the CLIs; Cloudflare routes; cross-process watching; loop events.

## Decisions

1. **`watchScript(harness, id, context)`** returns `{ [Symbol.asyncIterator], result, stop() }`.
   - `result` settles exactly as `waitForScript(harness, id, context)` would, and is implemented by calling it.
   - `stop()` detaches every pi-durable watch and ends the iterator. The run is untouched.
   - An id that names another kind of task rejects `result` and throws from the iterator with `task <id> is a <kind> task, not agentscript.run`. An id with no task gives `agentscript run <id> does not exist`. `waitForScript` doesn't reject on another kind of task, so the watcher checks the kind itself.
2. **Driving from the checkpoint.** Subscribe through `watchTaskGraph` and re-read the run with `getTask` on each change. Diff the new checkpoint against the last one seen:
   - **New entries in `state.steps`** emit `step_end` (and the missing `step_start` if the watcher never saw one).
   - **Entering `await` with a `conversationId`** emits `step_start` and attaches `watchEvents` to that conversation.
   - **Entering `act`** emits `action_start`.
   - **Its settled result** emits `action_end`.
   - **A terminal task** emits `run_end` with the `waitForScript` result, then the iterator ends.

   If `watchTaskGraph` can't scope to one task cheaply, poll `getTask` every 100 ms while the task is live. Pick one after reading pi-durable's `TaskGraphWatch`, and record the choice here.

   **Choice: `watchTaskGraph`, no polling.**
   - The watch is opened before the history read, so nothing committed in between is missed.
   - Each publication is filtered to this run's node, `value.tasks[String(id)]`. Only when that node's JSON changes is the run re-read with `getTask` and diffed. Reactions run serially, in order.
   - There is no 100 ms poll.
   - If the watch closes for any reason other than `stopped` or `cancelled`, the iterator fails with `watchScript: the task graph watch of run <id> closed (<reason>)`.
3. **Live deltas.** From the step conversation's events:
   - the `snapshot`'s in-flight `generation.message` text becomes one `text_delta` (thinking likewise);
   - each `message_update` change of type `text_delta`/`thinking_delta` is forwarded;
   - `tool_execution_start` becomes `tool_call { name, inputs: args }`;
   - `tool_execution_end` becomes `tool_result`, with `ok` and `outputs` read as the step's `toolCalls` will record them, from the step-actions doc entry for that call (`actionCalls()` in `extension.ts`).

   `submit_result` executions emit nothing, as in the pi port. The conversation watch stops at that step's `step_end`.
4. **History on attach.** Before subscribing, read the task once. Each step in `state.steps` gives `step_start` and `step_end` (no deltas). Each settled action in the state gives `action_start` and `action_end`. A finished run then gives `run_end`.
5. **Isolation.** Watching only reads. Each watcher has its own unbounded queue, so several watchers and slow readers are independent. A pi-durable watch that closes because the harness closes ends the iterator with an error naming the close, and `result` follows `waitForScript`.
6. **Text equality.** For a step watched from its `step_start`, its `text_delta`s joined must equal the final assistant message's text. pi-durable's partials are cumulative commits of the same message, so the forwarded changes reconstruct it. A test pins this with a throttled `partialIntervalMs`.

## Testing

On memory storage (`openMemoryStorage` or equivalent) and node SQLite, with pi's faux provider streaming its replies:
- a two-step run watched from before `harness.resume()`;
- a watcher attached mid-run;
- a watcher attached after the end;
- a tool step;
- two watchers at once;
- `stop()`.

## Risks

- **`watchEvents` is marked experimental in pi-durable 1.1.0.** Pin the behaviour with tests. A pi-durable bump that breaks it fails them, and that is a decision under the exact-pin rule.
- **Per-call outputs.** If the step-actions doc can't be read at `tool_execution_end`, emit `tool_result` from the tool's result entry instead, and record the difference here.

## Verified live

2026-10-28, Ollama `qwen3.5:latest`, from a throwaway script (not committed):
- **Setup.** A two-step text script (`greet`, `bye`) started with `startScript` on a `MemoryStorage` harness, with the plain extensions and `registerOllama`. It was watched with `watchScript` before `harness.resume()`.
- **Events.** `step_start:0`, `step_end:0`, `step_start:1`, `step_end:1`, `run_end`, in that order. Between them came 541 `thinking_delta` and 2 `text_delta`.
- **Text.** Each step's text deltas joined to its outcome's text: `Hello!` and `Goodbye!`.
- **Result.** `completed`, and `w.result` was equal to `waitForScript`'s result.
- **Not exercised live:** late attachment and tool steps. They are covered by `__tests__/durable/watch.test.ts`.

## Decisions made during the build

- **The task loop blocked on two questions** (group loop 974); the recommended path was taken on both.
  - The delegate may not edit `design.md`, so the checkpoint-subscription choice (decision 2) was written in by hand.
  - The spec delta had said an id that is not a run is refused "with `waitForScript`'s message", but `waitForScript` doesn't reject on another kind of task. The delta was amended to the watcher's own messages.
- **`tool_call` inputs are merged with the offer's bound inputs.** As first built, the watcher's `tool_call` carried the model's raw arguments, while the pi port's carries them overlaid with the offer's `bound`, which is what the call runs with. The recommended path was to make the two agree: at `tool_execution_start`, the watcher reads the step-actions doc's offer of that name and overlays its `bound`.
