## Context

The claude-code port (`src/claude-code/claude-code.ts`) spawns one `claude -p` per step through a `Runner` that resolves with the whole stdout. `reason(request, stream?)` already receives a `StreamSink` when the run has a listener (`add-run-streaming`); today the port forwards only the bridge's `tool_call`/`tool_result` to it.

Measured on Claude Code 2.1.310, Haiku 4.5, with `--output-format stream-json --verbose --include-partial-messages`:
- each stdout line is one JSON object;
- text arrives as `{ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }`;
- thinking arrives as `thinking_delta` with `thinking: ""` (redacted), plus `signature_delta`;
- a `--json-schema` step sends no text deltas, only `input_json_delta` for a `StructuredOutput` tool block;
- the last line is `{ type: "result", ... }`, with the same fields `--output-format json` prints (`subtype`, `is_error`, `result`, `structured_output`, `num_turns`, `stop_reason`, `api_error_status`, usage, cost).

## Decisions

1. **The sink is the switch.** `reason` streams exactly when it is given a `StreamSink`. No new port option: issue #19's `onText` would duplicate `run({ onEvent })` and work only on this port.
2. **The argv.** `ClaudeInvocation` gains `stream?: boolean`. When true, `--output-format json` becomes `--output-format stream-json --verbose --include-partial-messages`, in that place; every other flag and its order is unchanged. When false or absent the argv is today's, byte for byte. The claude-code pi provider and `provider-session.ts` never set it.
3. **`Runner`'s fourth argument.** `Runner = (args, input, env, onStdout?) => Promise<ProcessResult>`. `spawnIn` calls `onStdout` with each stdout chunk as a string, before adding it to `stdout`. `ProcessResult.stdout` is still the whole output. A runner that never calls it is valid: the step settles from `stdout` with no deltas.
4. **The line reader.** A small buffer splits the chunks on `\n`. Each complete line is parsed; a line that isn't JSON, or isn't a `stream_event` `content_block_delta`, is skipped. A `text_delta` with a non-empty `text` becomes `{ type: "text_delta", delta: text }`; a `thinking_delta` with a non-empty `thinking` becomes `{ type: "thinking_delta", delta }`. Nothing else is forwarded: `tool_use` blocks and `input_json_delta` are not, since the bridge reports calls and `StructuredOutput` is Claude Code's own mechanism.
5. **The outcome.** In stream mode the port finds the last stdout line that parses as an object with `type: "result"` and passes it to the same mapping as today (`toClaudeCodeOutcome` takes the parsed result or the raw stdout). No such line is a failure, category `unknown`, with the same `claude exited <code> without a JSON result` message and stderr detail.
6. **Tool steps.** `runToolStep` passes the same sink-driven `stream` flag and `onStdout`. Text deltas and the bridge's tool events go to one sink in the order they happen.
7. **Abort and timeout.** Unchanged. Deltas already sent stay sent; an aborted step still resolves `aborted` without waiting for the process.
8. **A sink that throws.** The port doesn't guard it, as the pi port doesn't: the runner's own sink is the caller's code.

## Testing

- `__tests__/pi/claude-code-stream.test.ts`, with fake runners that call `onStdout` with recorded stream-json lines, split across chunk boundaries, then resolve with the whole stdout.
- One `spawnRunner` scenario with a fake `claude` script that writes a line, waits, then writes another: `onStdout` sees the first before the process exits.
- Live: one more Haiku request in `pnpm test:claude-code`, a text step reasoned with a sink, asserting at least one `text_delta` arrived and their concatenation equals the outcome's text.

## Decisions made during the build

- **The reader closes when the step settles.** Found in review of group 1: after an abort, `reason` resolves without waiting for the process, and a dying `claude` may still flush stdout. Its deltas would have reached the sink after `step_end`, and the runner would tag them to the next step. `streamJsonReader` now returns `{ onStdout, close }`, and the port closes it as soon as the runner's result or the abort is in, so later chunks are dropped. Covered by a test in `claude-code-stream.test.ts` ("deltas a process reports after an abort never reach the sink"), not a spec scenario: it is the abort requirement holding, not new behaviour.
