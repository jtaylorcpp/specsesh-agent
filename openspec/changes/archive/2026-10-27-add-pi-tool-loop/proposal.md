## Why

A script can offer actions to the model (`reasoning.actions`), but only a durable host runs them. The pi reasoning port refuses any request that offers tools, because it makes exactly one model request and has nowhere to send a call. So a library consumer who wants an agent to call their own tools must stand up a pi-durable harness, a registry and a workspace, even for one in-process run. pi-ai already reports tool calls and accepts tool results. What's missing is a loop in the port and a place to plug in the code that runs each call.

## What Changes

- `createPiReasoningPort` takes an optional `tools`, a tool host: `(call: { name, tool, inputs }) => ActionResult`, sync or async. Without it, nothing changes: one request per step, and a request offering tools is refused as today.
- With `tools`, a step that offers tools runs a loop. The model sees the offers, plus `submit_result` on a structured step. Each tool call is checked against its offer's input schema, has the offer's bound inputs merged in, and runs on the host. Its result goes back to the model as a tool result. The step ends when the model answers with no tool call, or calls `submit_result`.
- A structured step whose model stops without calling `submit_result` gets one last request offering only `submit_result`, forced the way `forceTool` forces it today.
- Every executed call is recorded in the answer's `toolCalls`, in call order, so the interpreter's `set` clauses on reasoning actions apply exactly as they do under the durable host.
- `maxRounds` (default 16) bounds the model requests one step makes. Reaching it ends the step `cut-short`, the first time this port reports that kind.
- The refusal message names the new option alongside the durable host.

## Out of scope

- Loading tools in the CLIs and adapting a durable `ActionRegistry` to a tool host. That is `add-cli-tools`, stacked on this change.
- MCP servers as a tool source: `add-mcp-tools`.
- The claude-code reasoning port. It still refuses tools: `claude -p --json-schema` takes one schema and runs no loop we control.
- `run @actions.x` calls in a one-shot run. They already go to `run()`'s `actionHost`, and nothing here changes them.
- Parallel tool execution. Calls in one message run one at a time, in order.

## Capabilities

- **Modified:**
  - `pi/port`;
  - `core/reasoning-port`.

## Impact

- `packages/agent/src/pi/port.ts`: the loop, `PiToolHost` and `PiToolCall` types, exported from `src/pi/index.ts`. `src/pi` still imports only the interpreter and pi-ai.
- `packages/agent/src/interpreter/port.ts`: the `TOOLS_NEED_DURABLE_HOST` text only. The core still executes no tool.
- Tests in `__tests__/pi/` on pi's faux provider; no network.
- `packages/agent/README.md` (`## Run it once`) and `docs/llm/agent.md`: a short tool-host example for library use.
