## Why

Agent Script's only executable target is `mcpTool://<name>`, but nothing here speaks MCP. With `add-cli-tools`, a user can wrap any API in a JavaScript module, but most tools people already have ship as MCP servers: GitHub, file systems, databases, internal services. They are configured in a `.mcp.json` the user already keeps for Claude Code. Connecting to those servers directly lets a script call them with no glue code, and makes the target scheme mean what it says.

## What Changes

- **`mcpTools(servers, options?)`** in `./node` connects to each server and lists its tools. It returns `{ actions, skipped, close }`:
  - `actions` is a `HostAction[]`, one per usable tool, named `<server>/<tool>`, so a script targets `mcpTool://github/create_issue`;
  - `skipped` lists each tool that couldn't be mapped, with its reason;
  - `close` shuts every connection.
- **Server config** uses the `mcpServers` shape of Claude Code's `.mcp.json`. A server is either `{ command, args?, env?, cwd? }` (stdio) or `{ url, headers? }` (Streamable HTTP). `${VAR}` in any string is filled from the environment, so keys stay out of the file.
- **Mapping.**
  - **Inputs:** a tool's required scalar parameters (`string`, `number`, `integer`, `boolean`). A tool with any required non-scalar parameter is skipped.
  - **Outputs:** its `outputSchema`'s scalar fields, read from `structuredContent`, when it declares one. Otherwise a single `text` output, joining the result's text content.
  - **Errors:** an `isError` result or a transport error is `{ ok: false }` with the server's text.
  - **Kind and replay** come from the tool's annotations: a read-only tool is a `read`, and replays `safe` only if it is also idempotent. Anything else is a `command` that replays `unsafe`.
- **`--mcp <file>`** (repeatable) on `agent run`, `durable run` and `durable resume` loads a JSON file holding `mcpServers`, beside or instead of `--tools`.
  - Every server is connected before any model call. A server that fails to start or list exits `2`, naming it.
  - Each skipped tool is reported on stderr as `mcp: skipped <server>/<tool>: <reason>`.
  - Every connection is closed when the command ends, on every path.
- **`@modelcontextprotocol/sdk`** is pinned exactly at 1.32.1. It is an optional peer and a dev dependency of `@specsesh/agent`, and a dependency of `specsesh`. Only `src/node` imports it.

## Out of scope

- MCP resources, prompts, sampling, elicitation and notifications. Only tools are used.
- Optional and non-scalar tool parameters. Agent Script actions carry scalar inputs, and a binding names every input. The skipped list says why a tool is missing.
- OAuth flows for remote servers. Headers, with `${VAR}`, cover token auth.
- MCP in Cloudflare Workers, and in the task loop's `agentscript.config.json`.
- Serving our own scripts as an MCP server.

## Capabilities

- **New:** `actions/mcp`.
- **Modified:**
  - `pi/cli`;
  - `durable/cli`;
  - `package/distribution`.

## Impact

- `packages/agent/src/node/mcp.ts` (new), exported from `src/node/index.ts`.
- `packages/agent/src/bin/tools.ts`: `--mcp` loading beside `--tools`; both bins wire `--mcp` and close connections in `finally`.
- Manifests: `packages/agent/package.json` (peer, meta, dev) and `packages/specsesh/package.json` (dependency); the lockfile; `__tests__/package/layers.test.ts` (`src/node` may import the SDK) and `manifest.test.ts`.
- Tests: a fixture MCP server (stdio script, and Streamable HTTP on port 0) under `__tests__/fixtures/mcp/`, built on the SDK's server classes.
- `docs/llm/agent.md`, `docs/llm/durable.md` and README: `--mcp`, the naming and the mapping rules.
- This change touches four capabilities, two over the proposal gate's warning. The CLI and manifest deltas are each one or two ADDED or MODIFIED requirements, and splitting them out would leave `actions/mcp` unusable on its own.
