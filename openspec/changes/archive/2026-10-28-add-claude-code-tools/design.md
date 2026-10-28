## Context

The claude-code port (`src/claude-code/claude-code.ts`) runs one `claude -p --safe-mode --tools ""` per step and refuses any request offering tools with `TOOLS_NEED_DURABLE_HOST`. The pi port gained a tool loop in `add-pi-tool-loop`: `tools?: PiToolHost`, one call at a time, with arguments checked against the offer's schema (`checkArguments`), bound inputs merged over the model's (bound wins), and `ToolCallRecord`s and stream events emitted. `registryHost` (`src/durable/tool-host.ts`) turns the CLI's registry into a `PiToolHost`. Only `src/node` may import `@modelcontextprotocol/sdk`, and `src/node/mcp.ts` loads it lazily.

Claude Code takes MCP servers through `--mcp-config` (a file or a JSON string), and `--allowedTools` approves tools by name, as `mcp__<server>__<tool>`.

## Probes (Claude Code 2.1.310, Haiku, 2026-10-28)

Each probe asked Claude Code to call the fixture server's `add` tool (`__tests__/fixtures/mcp/server.mjs`), in an empty directory:

| Flags | Tool available? |
|---|---|
| `--safe-mode --tools "" --strict-mcp-config --mcp-config <stdio fixture>` | no: "I don't have an add tool" |
| `--safe-mode`, no `--tools` | no |
| `--safe-mode --tools mcp__agentscript__add` | no |
| `--safe-mode --plugin-dir <plugin with the server in .mcp.json>` | no |
| `--tools ""` with no `--safe-mode` | yes, answered `5` in 2 turns |

So `--safe-mode` turns off every MCP server, including those `--mcp-config` names, and `--tools ""` does not hide MCP tools.

Isolation without `--safe-mode`. Each run asked "Quote, verbatim, the first sentence of any CLAUDE.md or user instructions you were given beyond the system prompt, or say NONE", with `--system-prompt "You answer questions."`:

| Flags | Answer | Input tokens |
|---|---|---|
| `--safe-mode` | NONE | 642 |
| `--setting-sources "" --disable-slash-commands --strict-mcp-config` | NONE | 642 |
| `--setting-sources "" --strict-mcp-config` | NONE | 642 |
| nothing (control) | quoted the user's global CLAUDE.md | 4668 |

Transport: a Streamable HTTP server on `127.0.0.1` (the fixture's `startHttp`), named in `--mcp-config` with an `Authorization: Bearer` header, under the isolation flags plus `--permission-mode dontAsk`, `--allowedTools mcp__agentscript__add` and `--json-schema` for `{ sum: number }`. The structured output was `{ sum: 5 }` after 3 turns, every request carried the header, and `permission_denials` was empty.

## Goals / Non-Goals

**Goals:** a one-shot run on `--provider claude-code` offers its tools, and Claude Code calls them natively; every call runs on our host through the same `PiToolHost` the pi port uses; steps with no tools are unchanged; the hard lines hold (no OAuth token, never `--bare`, `ANTHROPIC_API_KEY` stripped, nothing from the user's configuration in a step).

**Non-Goals:** durable runs (the next change); Claude Code's built-in tools; streaming text; the task loop.

## Decisions

1. **Isolation for a tool step.** `claudeArgs` takes an optional `tools: { mcpConfig, allowedTools }`. With it, the `--safe-mode` at index 1 is replaced by `--setting-sources`, `""`, `--disable-slash-commands`, `--strict-mcp-config`, `--mcp-config`, `<mcpConfig>`, `--allowedTools`, `<allowedTools joined with ",">`, `--permission-mode`, `dontAsk`. The rest of the argv is unchanged, including `--tools ""` and the no-workspace note.
   - `--safe-mode` cannot stay, because it turns off the server (Probes). The replacement gave the same 642-token context.
   - `--disable-slash-commands` is kept although the probe didn't need it: skills live under the user's directory, and the flag costs nothing.
   - `allowedTools` goes as one comma-joined argument, because `--allowedTools` is variadic and would otherwise swallow the next flag.
   - Without `tools`, the argv is exactly today's.
   - **Choice:** replace `--safe-mode` only on tool steps, with these flags. This touches a hard line, so the `CLAUDE.md` line becomes: `--safe-mode` on every step that offers no tools; a tool step passes the measured replacement instead. The measurement is above, and it will be re-run at the live check.
2. **The bridge interface lives in `src/claude-code`; its implementation lives in `src/node`.** `tool-bridge.ts` exports `BridgeTool { name, description, inputSchema }`, `BridgeReply { ok, text }`, `BridgeHandler = (name, args) => Promise<BridgeReply>`, `ToolBridge { mcpConfig, allowedTools, close() }` and `ToolBridgeFactory = (tools, handler) => Promise<ToolBridge>`. `src/claude-code` can't import the SDK (layer rule), and the port is tested with a fake factory. The server name is fixed: `agentscript`.
3. **`mcpBridge()` in `src/node/mcp-bridge.ts`.**
   - It returns a `ToolBridgeFactory`. Each call starts an `http` server on `127.0.0.1`, port 0.
   - A request without `Authorization: Bearer <token>` (a random 32-byte hex token per bridge) gets `401`, and no MCP handling. Only `/mcp` is served; any other path gets `404`.
   - Each request gets a stateless SDK `Server` and `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), as in the fixture.
   - `tools/list` lists each tool with its `inputSchema`. `tools/call` calls the handler: `ok` gives a text content item; `!ok`, or a handler that throws, gives `isError: true` with the text or message.
   - The config, `{ mcpServers: { agentscript: { type: "http", url, headers: { Authorization } } } }`, is written to `<mkdtemp dir>/mcp.json` with mode `0600` (the directory is created `0700` by `mkdtemp`), and `mcpConfig` is that path. This keeps the token out of `ps`.
   - `allowedTools` is `mcp__agentscript__<name>` for each tool.
   - `close()` closes the server (`closeAllConnections`) and removes the directory. It is idempotent.
   - The SDK's server modules are imported on the first call, like `mcpTools`. A missing SDK rejects with `mcpBridge needs the optional peer @modelcontextprotocol/sdk`.
4. **The port's tool path.** `createClaudeCodeReasoningPort` takes `tools?: PiToolHost` and `bridge?: ToolBridgeFactory`.
   - `tools` without `bridge` throws a `TypeError` at creation: `tools need a bridge: pass bridge: mcpBridge() from @specsesh/agent/node`. A port without `tools` still refuses a tool request with `TOOLS_NEED_DURABLE_HOST`.
   - For a request with `tools`:
     - Every offer name must match `^[A-Za-z0-9_-]{1,48}$`, so `mcp__agentscript__<name>` stays within 64 characters. Otherwise the step fails `invalid_request` with `offered tool name <name> can't be served to claude`, and nothing is spawned.
     - The bridge starts with the offers (`name`, `description`, `inputSchema`). If it fails to start, the step fails `unknown` with `could not start the tool bridge: <message>`.
     - The handler finds the offer by name. An unknown name answers `!ok` and is not recorded, as in the pi loop. Bad arguments (`checkToolArguments`) answer `!ok`, are recorded with `ok: false` and `outputs: {}`, and emit one `tool_result` event.
     - Otherwise the inputs are `{ ...args, ...offer.bound }`; the handler emits `tool_call`, runs the host (a throw becomes `ok: false`), emits `tool_result`, records the call, and answers `JSON.stringify(outputs)` or the message.
     - The argv is `claudeCodeArgs(request, options)` plus the bridge's `tools`, with `maxTurns` set to `options.maxTurns ?? 16` (`DEFAULT_MAX_ROUNDS`).
     - The bridge closes in `finally`, on every path.
     - An `answered` outcome gets `toolCalls`, every call in arrival order, even when there are none. `cut-short` and `failed` carry none, as in the pi loop.
   - Events are emitted only when `reason` got a stream sink, so the existing "listening run" rule holds.
5. **`checkToolArguments`.** `checkArguments` in `src/pi/port.ts` is exported under this name, unchanged, and the pi loop keeps using it. `src/claude-code` may import `src/pi`.
6. **CLI.** In `agentscript-pi.ts`, with provider `claude-code` and a registry from `--tools` or `--mcp`, the port gets `tools: hosts.toolHost` and `bridge: mcpBridge()`. The usage line `tools: under --provider claude-code, a step that offers tools fails invalid_request` is removed from the `agent` usage and stays in the `durable` usage until the next change.
7. **`TOOLS_NEED_DURABLE_HOST`** becomes: `… Tools need the durable host (@specsesh/agent/durable), a pi reasoning port given a tool host (tools), or a claude-code port given tools and a bridge, which runs each call.` The core spec's requirement names "the pi and claude-code ports created without `tools`" as ports that can't run tools.

## Testing

- **Argv:** pure tests of `claudeArgs` with and without `tools`.
- **Port:** a fake `ToolBridgeFactory` that captures the handler, and a fake runner that, as Claude Code would, calls the handler (one good call, one bad call) before answering. The tests assert the host's calls, `toolCalls`, the events, the argv, and that `close` ran, on success and on failure.
- **Bridge:** `mcpBridge()` driven by the SDK `Client` over `StreamableHTTPClientTransport` with the header. The tests cover the list and calls, `401` without the token, the file's mode `0600` and its removal on `close`, and an `isError` result for a failing handler.
- **CLI end to end:** the fake `claude` in `__tests__/pi/cli.test.ts` gains a mode in which it reads the `--mcp-config` file, connects with the SDK client, calls the first allowed tool with fixed arguments, and prints a JSON success whose `result` carries the tool's text. `run <tools script> --provider claude-code --tools <echo module>` then completes with the echoed value.

## Risks

- **The isolation flags are an observed equivalence, not a documented one.** A later Claude Code could load something from a source these flags don't cover. Mitigations: tool steps only, the exact measurement recorded here, and the live check re-running it. A later Claude Code flag that keeps MCP under `--safe-mode` would let us go back to `--safe-mode` everywhere. Park that as something to watch.
- **The bridge is a local HTTP port.** It binds loopback only, needs a per-bridge random token that never appears in argv, and lives only for one step.
- **Parallel calls.** Claude Code may call tools concurrently. The host then sees concurrent calls, and records are in arrival order. The pi loop is sequential, so this is a difference worth noting in the docs.

## Verified live

2026-10-28, Claude Code 2.1.310, `--model haiku`, on the subscription (`ANTHROPIC_API_KEY` unset).

```bash
node packages/agent/dist/bin/agentscript-pi.js run packages/agent/examples/tools/tools.agent \
  --entry echo_it --entry count_it --tools packages/agent/examples/tools/tools.mjs --provider claude-code --model haiku --json
```

- **The tools example:** exit `0`, `completed`. Claude Code called `word_count` natively through the bridge. The step's `toolCalls` was `[{ name: "word_count", inputs: { text: "Agent Script runs your own tools" }, ok: true, outputs: { count: 6 } }]`, and `count = 6`. No `agentscript-bridge-*` directory was left in the temp directory.
- **The isolation probe, re-run through a real tool step** (a one-step script offering `word_count`, asking for the first sentence of any CLAUDE.md or user instructions): it answered `NONE`. The only tool it listed was `mcp__agentscript__word_count`.
- **Account metadata:** the model reported an email address in its context. A `--safe-mode` step reports the same, so this is Claude Code's baseline, not something the tool flags add.
