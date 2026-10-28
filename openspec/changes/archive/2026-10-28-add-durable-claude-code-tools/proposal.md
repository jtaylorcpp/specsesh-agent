## Why

`add-claude-code-tools` lets Claude Code call a one-shot step's tools natively, through a loopback MCP bridge. A durable run on `--provider claude-code` still refuses them: the claude-code pi provider takes at most one tool per request and sends it as `--json-schema`. Under pi-durable, each tool call must be run by the harness, as a checkpointed host action with its replay rule, its record in the step-actions doc and its `watchScript` events. So the provider can't simply let Claude Code run them. It can still let Claude Code *call* them: the bridge holds each call while pi-durable runs it, then hands the result back to the same `claude` process.

## What Changes

- **`claudeCodeProvider({ bridge })`.** When a request offers any tool other than `submit_result`, the provider starts a *session*: a bridge serving those tools, and one `claude -p` with the tool-step flags (`submit_result`'s parameters as `--json-schema`), held across provider requests.
  - Each call Claude Code makes through the bridge is held, and the provider answers the request with that call as a pi `toolCall`. Every call waiting at that moment goes in one message.
  - pi-durable runs the call as usual. When the next request carries its `toolResult`, the provider hands the result to the held call, and Claude Code continues.
  - When the process ends, the provider answers as it does today: text, a `submit_result` call, or an error. The bridge is then closed.
- **Crash safety.** A held process doesn't survive a crash. On resume, a request whose results name no live session starts a fresh process, with the whole transcript rendered by `promptOf` (prior calls and results included). Every call already ran in pi-durable and isn't repeated.
- **Without `bridge`**, the provider behaves exactly as today, and its refusal of a request offering more than one tool now names `bridge`.
- **The bins** register the provider with `bridge: mcpBridge()` (`cliModels`), so `durable run`/`resume` with `--tools` or `--mcp` offer tools on claude-code. The `durable` usage line saying such a step fails is removed.

## Out of scope

- The Cloudflare host. No `claude` binary runs there.
- Streaming text from claude-code.
- Keeping a held process across a crash.

## Capabilities

- **Modified:**
  - `pi/claude-code`;
  - `durable/cli`.

## Impact

- `packages/agent/src/claude-code/claude-code-provider.ts`: the `bridge` option and sessions. A new `src/claude-code/provider-session.ts` may hold the session.
- `packages/agent/src/bin/models.ts`: `cliModels` passes `bridge: mcpBridge()`. `agentscript-durable.ts`: the usage line.
- Tests: provider sessions with a fake bridge and a scripted runner, and a durable CLI run against a fake `claude` that calls a tool over MCP.
- Docs: `docs/llm/durable.md`, `docs/providers/claude-code.md` and `CLAUDE.md` (the provider bullet).
