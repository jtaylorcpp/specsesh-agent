## Why

A library host that runs a script, such as a chat UI, a server answering a request, or an editor panel, sees nothing until `run()` resolves. A multi-step script on a slow model can take a minute, and in that time the user has no text, no sign of which step is running, and no view of the tools being called. pi-ai streams every provider (`models.stream()`, with `text_delta`, `thinking_delta` and `toolcall_*` events), but the pi port calls `complete()` and throws the stream away. This change is for library consumers only. The CLIs stay as they are.

## What Changes

- **One event vocabulary for a run,** `RunEvent`, exported from `./interpreter`:
  - `step_start` and `step_end` (with the outcome);
  - `text_delta` and `thinking_delta`;
  - `tool_call` and `tool_result` (the model's calls in a tool loop);
  - `action_start` and `action_end` (`run` statements);
  - `run_end` (with the result).

  Each event names its step. The type is plain JSON, so a durable host can produce the same events (`add-durable-streaming`).
- **`run(source, { ..., onEvent })`** calls `onEvent` with each event in order. A listener that throws never changes the run.
- **`streamRun(source, options)`** returns an async iterable of `RunEvent`s with a `result` promise, for `for await` consumers. Events are buffered, so a slow reader loses none.
- **`ReasoningPort.reason(request, stream?)`** gains an optional second argument, `{ onDelta }`. A port may report text, thinking and tool-loop deltas through it, and the runner tags each with the current step. A port that ignores it still works, with only step, action and run events. The interpreter still makes no model call.
- **The pi port** uses `models.stream()` when `onDelta` is given, forwards text and thinking deltas, and reports each tool-loop call and result (`add-pi-tool-loop`). It maps the final message exactly as `complete()`'s, so a streamed step's outcome equals an unstreamed one's.

## Out of scope

- **CLI output.** No flag, and no change to `agentscript-pi`, `-durable`, `-task` or `-change` output.
- **Durable runs:** `add-durable-streaming`, stacked on this change.
- **Streaming from the claude-code port.** It gets step and action events only. `--output-format stream-json` is a later change, and it is parked.
- **Partial structured results.** `toolcall_delta` JSON fragments for `submit_result` are not forwarded, because a half-parsed result is not a result.
- **Cancelling mid-step through the stream.** `signal` on the port already exists.

## Capabilities

- **Modified:**
  - `core/reasoning-port`;
  - `core/step-machine`;
  - `pi/port`.

## Impact

- `packages/agent/src/interpreter/events.ts` (new): `RunEvent` and `StreamDelta`. `run.ts` gets `onEvent` and `streamRun`, and `port.ts` gets the optional second argument. Still no model client in the core.
- `packages/agent/src/pi/port.ts`: the streamed request path and delta forwarding, including from the tool loop.
- `packages/agent/src/claude-code/claude-code.ts`: the port's signature only, as it ignores `stream`.
- Tests in `__tests__/core/` (a recording port that emits deltas) and `__tests__/pi/` (pi's faux provider, which streams).
- `packages/agent/README.md`: a `streamRun` example. `docs/llm/agent.md` says streaming is library-only.
