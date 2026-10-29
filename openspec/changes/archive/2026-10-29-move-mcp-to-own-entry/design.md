## Context

`add-mcp-tools` (0.4.0) made `src/node/mcp.ts` and `src/node/mcp-bridge.ts` load the MCP SDK with `await import(...)` on first use, so importing `./node` needed no optional peer. A consumer bundling with Bun also imports the SDK statically for its own MCP server. Bun then wraps pi-ai's `models` and `event-stream` modules in `__esm` lazy initialisers that are never called, so `AssistantMessageEventStream` is `undefined` when the claude-code pi provider builds its stream. Bun 1.3.0, 1.4.2 and 1.4.4 did not fail in our minimal reproductions (`bun run`, `bun build` with and without `--splitting`/`--compile`, `bun test`), so we remove the reported trigger instead of patching around a symptom.

## Goals / Non-Goals

**Goals:** no library entry imports the SDK dynamically; `./node` loads no SDK module at all; the bins still run without the SDK.

**Non-Goals:** supporting Bun as a tested runtime; changing MCP behaviour.

## Decisions

1. **A new `./mcp` entry, not static imports in `./node`.** Static imports in `./node` would make every `./node` user install the SDK, reversing 0.4.0's choice. A separate entry keeps `./node` peer-free and makes the SDK requirement visible in the import path. Rejected: re-exporting `./mcp` from `./node` (same cost as static imports).
2. **`src/mcp/` is a layer.** It may import the core, `src/durable/` (action types), `src/claude-code/` (the bridge types) and `@modelcontextprotocol/sdk`; it is the only directory that imports the SDK. `src/node/` loses the SDK. Nothing in a layer imports `src/mcp/`; only `src/bin/` does.
3. **The bins load `./mcp` lazily.** `agentscript-*` and `specsesh` are entry points, not modules a consumer bundles, and the agent package's bins must still start without the optional peer. `src/bin/models.ts`, `src/bin/tools.ts` and `src/bin/agentscript-pi.ts` reach it through one `await import("../mcp/index.js")` (decision 6); the static import in `agentscript-pi.ts` goes. A missing SDK surfaces as `MCP needs the optional peer @modelcontextprotocol/sdk; install it (<cause>)`.
4. **Breaking in a patch.** 0.x; `mcpTools` and `mcpBridge` move to `@specsesh/agent/mcp`. The readme says so, and so do the release notes. Ships as 0.4.4 at the principal's request.
5. **Entry order:** `./mcp` directly after `./node`, the layer it was split from.

## Decisions made during the build

6. **The bins' loader is `src/bin/mcp.ts`** (`importMcp`, `lazyMcpBridge`), named so it doesn't clash with `loadMcp` in `src/bin/tools.ts`. `lazyMcpBridge` imports `./mcp` on the first tool step, so `cliModels` no longer touches the SDK at start.
7. **`pack:check` keeps its Node peers without the SDK** and imports every Node entry but `./mcp` there, proving `./node` and the bins load without it; `./mcp` is imported in a second project that adds `@modelcontextprotocol/sdk` at its dev version.

## Risks / Trade-offs

- Not reproduced here: the fix rests on the consumer's diagnosis. The regression tests pin the shape (no dynamic SDK import in `src/`; importing `dist/node/index.js` resolves no SDK module), not Bun's behaviour.
- Consumers importing `mcpTools`/`mcpBridge` from `./node` break at type-check or import time, loudly.

## Testing

- "Importing ./node loads no MCP SDK module": spawn `node` with a `module.registerHooks` resolve hook that records every resolved URL, import `dist/node/index.js`, and check that none contains `@modelcontextprotocol`.
- "No source imports the SDK dynamically": scan `src/` for `import("@modelcontextprotocol`.
