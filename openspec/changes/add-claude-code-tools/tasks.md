## 1. Argv and the bridge types

- [x] 1.1 `packages/agent/src/claude-code/tool-bridge.ts`: `BridgeTool`, `BridgeReply`, `BridgeHandler`, `ToolBridge`, `ToolBridgeFactory` and `BRIDGE_SERVER` (`design.md` decision 2), exported from `src/claude-code/index.ts`. `claudeArgs` and `ClaudeInvocation` take `tools?: { mcpConfig, allowedTools }` (decision 1). Update the module comment in `claude-code.ts` for the tool-step flags. Tests in `__tests__/pi/claude-code.test.ts`: "Scenario: Headless, safe mode, no tools, no saved session", "Scenario: A schema and a turn bound are appended in order", "Scenario: Never bare", "Scenario: A tool step is isolated without safe mode", "Scenario: The tool flags replace safe mode in place", "Scenario: The bridge server name is agentscript"
- [x] 1.2 `src/pi/port.ts`: export `checkArguments` as `checkToolArguments` (decision 5), with the pi loop unchanged. `src/interpreter/port.ts`: the new `TOOLS_NEED_DURABLE_HOST` text (decision 7). Tests in `__tests__/pi/actions-port.test.ts`: "Scenario: The pi port refuses a tool request", plus renaming the existing claude-code refusal test to "Scenario: The claude-code port without tools refuses a tool request" and asserting `claude-code port given tools`

## 2. The port's tool path

- [x] 2.1 `createClaudeCodeReasoningPort`'s `tools` and `bridge` options and the tool path (decision 4), in `src/claude-code/claude-code.ts`. Tests in a new `__tests__/pi/claude-code-tools.test.ts`, with a fake bridge factory and a runner that drives the captured handler: "Scenario: tools need a bridge", "Scenario: A tool step passes the bridge's server and a turn bound", "Scenario: The bridge is closed when the step fails", "Scenario: A bridge that will not start fails the step", "Scenario: An unservable tool name is refused before spawning"
- [x] 2.2 In the same file: "Scenario: A call runs on the host with bound inputs winning", "Scenario: Bad arguments never reach the host", "Scenario: A listening run sees the bridge's calls"

## 3. mcpBridge

- [x] 3.1 `packages/agent/src/node/mcp-bridge.ts`: `mcpBridge()` (decision 3), exported from `src/node/index.ts`, with the SDK's server modules loaded lazily. Tests in a new `__tests__/node/mcp-bridge.test.ts`, using the SDK `Client` and `StreamableHTTPClientTransport`: "Scenario: The bridge lists and calls its tools", "Scenario: A request without the token is refused", "Scenario: A failing handler is an error result", "Scenario: The config file is private and removed on close". `pnpm pack:check` still passes (every Node entry imports without the SDK)

## 4. The CLI and docs

- [ ] 4.1 `src/bin/agentscript-pi.ts`: with `--provider claude-code` and `--tools` or `--mcp`, pass `tools` and `bridge: mcpBridge()`. Remove the claude-code tools line from the `agent` usage only (decision 6). In `__tests__/pi/cli.test.ts`, the fake `claude` gains a mode that reads `--mcp-config`, calls the first allowed tool through the SDK client and answers with its text (`design.md` "Testing"). Tests: "Scenario: Any claude alias is accepted", "Scenario: A claude-code run calls a --tools tool through the bridge"
- [ ] 4.2 Docs: in `packages/agent/README.md` and `docs/llm/agent.md`, claude-code with `--tools`/`--mcp` (Claude Code calls them itself, possibly in parallel, and durable runs don't support it yet); in `packages/agent/docs/providers/claude-code.md`, the tool-step flags and why; in `CLAUDE.md`, the `--safe-mode` line and the `--provider claude-code` paragraph (design decision 1); in `openspec/parked.md`, going back to `--safe-mode` for tool steps if Claude Code ever keeps `--mcp-config` servers under it. Run `pnpm docs:check`, `pnpm check`, `pnpm test`, `pnpm pack:check`

The change ends with a live check by the principal's agent: `examples/tools` on `--provider claude-code`, re-running the isolation probe, recorded in `design.md` under "Verified live". Then `pnpm change close add-claude-code-tools`.
