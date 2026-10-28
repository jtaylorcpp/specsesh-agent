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
