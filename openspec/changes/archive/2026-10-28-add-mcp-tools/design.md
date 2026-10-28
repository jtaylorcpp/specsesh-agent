## Context

After `add-cli-tools`, both bins load a registry from `--tools` modules (`src/bin/tools.ts`), one-shot runs execute through `registryHost`, and durable runs through `agentScriptExtensions`. A `HostAction` is `{ name, kind, inputs, outputs, replay, execute }` with scalar parameter types. The scan accepts any name after `mcpTool://`, `/` included (`delegate/<name>` already uses it). The official TypeScript SDK, `@modelcontextprotocol/sdk`, provides `Client`, `StdioClientTransport` and `StreamableHTTPClientTransport`, and on the server side `McpServer` with matching transports, which the tests use.

## Goals / Non-Goals

**Goals:** a user's existing `.mcp.json` works unchanged with `--mcp`; MCP tools become ordinary `HostAction`s, so they run one-shot and durably with no other code path; refusals before any model call.

**Non-Goals:** resources and prompts; optional parameters; OAuth; Workers; the task loop's config.

## Decisions

1. **`src/node/mcp.ts`.** stdio spawns processes, so this is Node. The HTTP transport alone could run in a Worker, but splitting the module isn't worth it before a Worker host asks for it. The SDK is imported only here. `src/node` is the layer allowed to add it, and the layer test lists it.
2. **Config.** `McpServers = Record<string, McpServerConfig>`, where `McpServerConfig = { command, args?, env?, cwd? } | { url, headers? }`, matching the entries of Claude Code's `.mcp.json`. A `type` field (`stdio`, `http`) is accepted and checked against the shape. `sse` is refused as unsupported. `${VAR}` and `${VAR:-default}` expand from `options.env` (default `process.env`). An unset variable with no default is an error naming the server and the variable. A stdio server's environment is the SDK's `getDefaultEnvironment()` plus its `env`, never all of `process.env`. Server names must match `^[A-Za-z0-9_-]+$` and must not be `delegate`.
3. **Connect, then list.** The servers are connected in parallel. Each lists its tools, following `nextCursor` until it runs out. Any failure (spawn, handshake, list, or a 30 s `timeoutMs` per server) closes everything already open and throws `McpServerError` naming the server and the reason. A partial set of servers would let a run bind against a subset nobody asked for.
4. **Mapping a tool** (`mapTool`, exported for tests):
   - **Inputs.** Every property in `inputSchema.required` must have a scalar type (`string`; `number`; `integer` as `number`; `boolean`). A required property of any other type, or with no type, skips the tool with `required parameter <p> is <type>`. Optional properties are not inputs. They are left unset, and that is noted under Risks.
   - **Outputs.** When `outputSchema` declares properties and every one has a scalar type, those are the outputs (all of them, required or not), read from `structuredContent`. A missing optional field is answered as a failure naming it, because a declared output must arrive. Otherwise the outputs are `{ text: "string" }`: the result's `text` content items joined with `\n`, and non-text items ignored.
   - **Kind and replay.** `readOnlyHint` gives `read`, otherwise `command`. Replay is `safe` only for `readOnlyHint && idempotentHint`, otherwise `unsafe`. `description` is the tool's own.
   - **Execute.** `client.callTool({ name, arguments: inputs }, undefined, { signal, timeout })`. An `isError` result is `{ ok: false, message: <text or "the tool reported an error"> }`. A thrown or transport error is `ok: false` with its message. Outputs pass through `registryHost`'s declared-outputs check like any other action.
5. **Names.** Each action's name is `<server>/<tool>`. A tool name that is not `^[A-Za-z0-9_.-]+$` is skipped. MCP allows more characters than the target scanner reliably handles.
6. **CLI.** `--mcp <file>` (repeatable) reads JSON with a top-level `mcpServers` object. Any other shape is refused with `--mcp <file>: <problem>`, exit `2`. All files' servers are merged, and a name repeated across files is refused. The actions join the `--tools` actions in one `createActionRegistry`, which still refuses duplicates. `skipped` goes to stderr, one line each, before the run. `close()` runs in the bins' `finally`, after the harness closes. `resume` takes `--mcp` like `--tools`, and the resume hint repeats it.
7. **Dependency.** `@modelcontextprotocol/sdk` is pinned at exactly `1.32.1`, the newest release that is at least two weeks old on 2026-10-27. In `@specsesh/agent` it is an optional peer at `^1.32.1` and a dev dependency at `1.32.1`. In `specsesh` it is a dependency at the dev version, like pi-ai. Any SDK import outside `src/node/mcp.ts` fails the layer test.

## Spec-delta coordination

`add-cli-tools` adds `--tools` through ADDED requirements, so this change's CLI deltas are ADDED too, and the stack folds in either order. The `package/distribution` deltas MODIFY three requirements that no other open change touches.

## Testing

`__tests__/fixtures/mcp/server.mjs` is an `McpServer` with these tools:
- `echo` (`{ text } → text`);
- `add` (with `outputSchema` `{ sum: number }`);
- `fail` (`isError`);
- `tags`, whose required parameter is an array, to exercise skipping.

The fixture is runnable over stdio (spawned with `node`), or over Streamable HTTP on port 0 when imported by a test. A `crash` flag makes the stdio process exit before the handshake.

## Risks

- **Optional parameters are unreachable.** A tool whose useful behaviour needs one can't be driven fully. A later change could add per-tool input selection in the config. Park it.
- **Long-lived servers in durable resumes.** Each process reconnects, and tool state on the server side is the server's business. An unsafe call interrupted by a crash is reported, not repeated (the replay rule).
- **SDK churn.** The pin is exact, and bumping it is a deliberate change with the fixture tests as the check.

## Verified live

2026-10-28, against a third-party stdio server, `@modelcontextprotocol/server-everything` 2026.8.31 (launched through `pnpm dlx … stdio`), on Ollama `qwen3.5:latest`. The `--mcp` file named it `everything`; the script ran `mcpTool://everything/echo` (input `message`, output `text`) once with `run`, without the model, and once offered under `reasoning.actions` for the model to call.

```bash
node packages/agent/dist/bin/agentscript-pi.js run .agentscript/mcp-live/echo.agent --entry echo_it --entry ask_model \
  --mcp .agentscript/mcp-live/servers.json --provider ollama --model qwen3.5:latest --json
node packages/agent/dist/bin/agentscript-durable.js run .agentscript/mcp-live/echo.agent \
  --db .agentscript/mcp-live/runs.sqlite --entry echo_it --entry ask_model \
  --mcp .agentscript/mcp-live/servers.json --provider ollama --model qwen3.5:latest
```

`servers.json` was `{ "mcpServers": { "everything": { "command": "pnpm", "args": ["dlx", "@modelcontextprotocol/server-everything@2026.8.31", "stdio"] } } }`, in the gitignored `.agentscript/`.

- **`agentscript-pi run`:** exit `0`, `completed`. The `run` call answered `{ ok: true, outputs: { text: "Echo: hello from Agent Script" } }`; the model called `echo` with `{ message: "ollama says hi" }` and got `Echo: ollama says hi`. Both landed in the variables (`echoed`, `model_echoed`).
- **`agentscript-durable run`:** exit `0`, `completed`, the same variables. The resume hint repeated the flag: `resume with: agentscript-durable resume 7 --db .agentscript/mcp-live/runs.sqlite --mcp .agentscript/mcp-live/servers.json`.
- **Skipped:** no `mcp: skipped` line on either run; every tool the server listed mapped.
- **Lifecycle:** after each command, no `server-everything` process was left running.

## Decisions made during the build

- **The SDK is loaded lazily.** As first built, `src/node/mcp.ts` imported the SDK statically, so importing `./node` (and `./task`, which builds on it) failed without the optional peer installed. Group 4 covered for this by adding the SDK to the pack test's Node peers. The recommended path was to keep the peer optional for real: `mcp.ts` imports only types at load time, and `mcpTools` imports the SDK's runtime classes on first call. A missing SDK then rejects with `mcpTools needs the optional peer @modelcontextprotocol/sdk`. The pack test went back to installing only pi-ai, pi-durable and chord, which proves that every Node entry imports without the SDK. `specsesh` still depends on it, so the CLI's `--mcp` always has it.
