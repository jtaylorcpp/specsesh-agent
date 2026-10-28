## Why

With `add-cli-tools` and `add-mcp-tools`, a one-shot run can offer tools to the model, but only through pi. `--provider claude-code`, the way to run on a Claude subscription, still refuses any step that offers tools: each step is `claude -p --tools ""`. Claude Code is itself a tool-using agent, and it takes MCP servers through `--mcp-config`. If the port serves the step's offered tools to Claude Code as one local MCP server, Claude Code calls them natively, in its own loop, while each call still runs on our host through the same `PiToolHost`.

## What Changes

- **A tool bridge.** `src/claude-code` defines the `ToolBridgeFactory` interface: given a step's tools and a handler, it returns `{ mcpConfig, allowedTools, close }`. `mcpBridge()` in `./node` implements it: a Streamable HTTP MCP server on `127.0.0.1`, port 0, that needs a random bearer token. It writes its `--mcp-config` file with mode `0600` in a private directory, so the token is never in argv.
- **The port runs tools.** `createClaudeCodeReasoningPort({ tools, bridge })` takes a `PiToolHost`, as the pi port does, and a bridge factory. For a step that offers tools, it starts the bridge, runs one `claude -p` with the server and only its tools allowed, and closes the bridge after.
  - Each call is checked against its offer's schema, bound inputs win, and the host runs it.
  - The answer records every call (`toolCalls`), and a listening run gets `tool_call` and `tool_result` events.
  - `--max-turns` defaults to 16 on a tool step, so reaching it ends `cut-short`, like the pi loop.
- **The isolation flags.** `--safe-mode` turns off every MCP server, `--mcp-config` included (measured on Claude Code 2.1.310). So a tool step replaces `--safe-mode` with `--setting-sources "" --disable-slash-commands --strict-mcp-config`, plus `--permission-mode dontAsk`. Measured on that version, this gives the same context as `--safe-mode`. A step that offers no tools keeps today's argv exactly. `--bare` is still never passed.
- **The CLI.** `agent run --provider claude-code` with `--tools` or `--mcp` passes the registry's tool host and `mcpBridge()`.

## Out of scope

- **Durable runs on claude-code with tools.** pi-durable must run and checkpoint each call itself, so the provider can't let Claude Code run them. That is the next change, `add-durable-claude-code-tools`.
- Claude Code's built-in tools (Read, Bash, …). They stay off, and delegates remain the way to reach them.
- Streaming text from claude-code (`stream-json`). That stays parked.
- The task loop and Cloudflare.

## Capabilities

- **Modified:**
  - `pi/claude-code`;
  - `core/reasoning-port`;
  - `pi/cli`.

## Impact

- `packages/agent/src/claude-code/tool-bridge.ts` (new): the bridge types. `claude-code.ts`: `claudeArgs`'s `tools`, and the port's tool path. Both are exported from `src/claude-code/index.ts`.
- `packages/agent/src/node/mcp-bridge.ts` (new): `mcpBridge`, exported from `src/node/index.ts`. It loads the SDK lazily, as `mcpTools` does.
- `packages/agent/src/pi/port.ts`: exports the argument check as `checkToolArguments`, so both ports refuse bad arguments the same way.
- `packages/agent/src/interpreter/port.ts`: the `TOOLS_NEED_DURABLE_HOST` text also names a claude-code port given tools.
- `packages/agent/src/bin/agentscript-pi.ts`: wiring and usage.
- Docs: README, `docs/llm/agent.md`, `docs/providers/claude-code.md`, `CLAUDE.md` (the `--safe-mode` line) and `openspec/parked.md`.
- Three capabilities, one over the proposal gate's warning. The reasoning-port and CLI deltas each modify one requirement whose text names the claude-code port as unable to run tools.
