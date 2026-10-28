## Why

Issue #19: a desktop host shows each agent's answer growing word by word in a chat log. On `--provider claude-code` it can show the answer only once it is complete, because the port runs `claude -p --output-format json` and the step's text arrives only when the step ends. Since 0.4.0, `run({ onEvent })` and `streamRun()` stream `text_delta` events from the pi port, but the claude-code port ignores the `StreamSink` it is given for text: it reports only the bridge's tool calls.

## What Changes

- **A listening step streams.** When `reason` is given a `StreamSink` (the run has a listener), the claude-code port runs `--output-format stream-json --verbose --include-partial-messages` in place of `--output-format json`. It passes each text delta on as a `text_delta`, as Claude Code produces it, and each non-empty thinking delta as a `thinking_delta`.
- **The outcome is unchanged.** It is read from the stream's final `result` line, which carries the same fields as the `json` output: the final text, `structured_output`, `cut-short` at max turns, the failure categories, `onResult`. A stream with no `result` line fails as non-JSON output does today.
- **No listener, no change.** A step reasoned without a sink keeps today's argv exactly.
- **Tool steps stream too.** Text between calls arrives as `text_delta`. Calls are still reported once, by the bridge, as `tool_call` and `tool_result`.
- **`Runner` gains an optional fourth argument**, `onStdout(chunk)`, which `spawnRunner` calls as stdout arrives. A custom runner that ignores it still settles, with no deltas.

The issue asks for an `onText` option on the port. This change uses the `StreamSink` that `reason` already takes instead, so a host gets word-by-word text through `run({ onEvent })` or `streamRun()` the same way on every provider.

## Out of scope

- **The claude-code pi provider** (held sessions and durable runs): pi-durable checkpoints whole messages, and streaming its text is a separate change. Parked.
- **CLI streaming.** The bins print the result at the end.
- **Streaming a structured result.** Claude Code sends it as `StructuredOutput` tool input, not text, so a structured step streams no text; its value still comes from the `result` line.

## Capabilities

- **Modified:** `pi/claude-code`.

## Impact

- `packages/agent/src/claude-code/claude-code.ts`: `claudeArgs` (a `stream` invocation field), `Runner`'s `onStdout`, `spawnIn`, a stream-json line reader, and the port's `reason` and `runToolStep`.
- Tests: `__tests__/pi/claude-code-stream.test.ts` (new); one live scenario in `__tests__/live/claude-code-tools.live.test.ts`.
- Docs: `docs/llm/agent.md`, `docs/providers/claude-code.md`, the module comment, and `CLAUDE.md`.
