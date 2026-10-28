## Context

`run()` loops `next` → `port.reason(request)` → `apply` (`src/interpreter/run.ts`), and action calls go through `actionHost`. The port contract has one method with one argument (`core/reasoning-port`). After `add-pi-tool-loop`, the pi port may make several requests per step and runs tool calls on a host. pi-ai 1.1.0's `models.stream(model, context, options)` returns an `AssistantMessageEventStream`: async-iterable events, then `result()` with the final `AssistantMessage`, the same object `complete()` resolves.

## Goals / Non-Goals

**Goals:**
- live text, thinking, tool and step progress for library hosts;
- the same `RunEvent` type later for durable runs;
- a streamed run produces the same `RunResult` as an unstreamed one.

**Non-Goals:** the CLIs; durable (`add-durable-streaming`); claude-code deltas; partial structured results.

## Decisions

1. **The vocabulary** (`src/interpreter/events.ts`). Every event has `type` and, except `run_end`, `step` (the 0-based index into `result.steps`, or, for actions, of the step that follows) and `subagent`:
   - **Step boundaries:** `step_start`; `step_end { outcome }`.
   - **Deltas:** `text_delta { delta }`; `thinking_delta { delta }`.
   - **Model tool calls:** `tool_call { name, inputs }`; `tool_result { name, ok, outputs }`.
   - **`run` statements:** `action_start { action, tool, inputs }`; `action_end { action, tool, ok, outputs }`.
   - **End:** `run_end { result }`.

   All of it is JSON. `StreamDelta` is the port-side subset (text, thinking, tool call and result) without `step` or `subagent`, which the runner adds.
2. **The port's second argument.** `reason(request, stream?: { onDelta(delta: StreamDelta): void })`. It is optional, so every existing port and test port type-checks unchanged. The runner passes it only when someone is listening (`onEvent` or `streamRun`). A port without a listener therefore takes its old path, and the pi port keeps calling `complete()`. The single `.reason(` call site in `run.ts` stays single.
3. **Ordering and isolation.** Events are delivered synchronously, in order: `step_start`, then the port's deltas, then `step_end`. Actions are `action_start` then `action_end`, and `run_end` comes last. A delta the port reports after `reason` settles is dropped. A listener that throws is caught: the error is not rethrown, the run goes on, and later events are still delivered.
4. **`streamRun`** returns `{ [Symbol.asyncIterator], result }`. Events go into an unbounded queue. The iterator drains the queue, ending after `run_end`, or throwing the run's rejection once the buffered events are drained. `result` resolves or rejects as `run()` would. The run starts at the call, not on first iteration, so `await stream.result` alone works. Iterating twice is refused, because a second iterator would miss events.
5. **The pi port.** When `stream` is given, each request uses `models.stream()` with the same context and options. `text_delta` and `thinking_delta` are forwarded, and the final message is `await s.result()`, mapped by `toOutcome` as today. The tool loop reports `tool_call` before running a call (after the argument check, with the merged inputs) and `tool_result` after it. A call refused by the argument check reports `tool_result` `ok: false` with no `tool_call`. `submit_result` and an unoffered name report nothing. `toolcall_delta` is not forwarded.
6. **Spec coordination.** `pi/port`'s "One reason call is exactly one model request" is MODIFIED here from its `add-pi-tool-loop` text: it now says `complete()`, or `stream()` when streamed. This change must close after `add-pi-tool-loop`, as the stack already orders it.

## Testing

- **Core:** a recording port that reports deltas before resolving, and one that reports after.
- **pi:** the faux provider, whose `stream()` emits real delta events. Assert that the deltas concatenate to the step's final text, that a streamed and an unstreamed run of the same script give equal results, and the tool-loop event order.

## Risks

- **Providers whose streamed and completed outputs differ.** pi builds `complete()` from the stream for every API, so the final message is the same object shape. The equality test pins it on faux.
- **Unbounded buffering.** A consumer that never reads holds every event of one run in memory. That is bounded by one run's output, and the docs say so.
