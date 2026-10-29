## Why

A Bun app that imports `@specsesh/agent/node` and also imports the MCP SDK statically fails its first claude-code step with `undefined is not a constructor (evaluating 'new AssistantMessageEventStream')`. `./node` loads the SDK with dynamic `import()`s (`node/mcp.js`, `node/mcp-bridge.js`), and mixing those with the app's static imports of the same SDK modules makes Bun wrap pi-ai's `models` and `event-stream` modules in lazy initialisers that never run. The consumer reproduced it on Bun 1.4.2 in CI; our minimal reproductions did not, so the fix removes the trigger rather than a symptom: no dynamic import of the SDK anywhere in the library entries.

## What Changes

- A new entry, `@specsesh/agent/mcp` (`src/mcp/`), holds `mcpTools`, `mapTool`, `McpServerError`, the MCP config types and `mcpBridge`, and imports the MCP SDK statically. It needs the optional peer `@modelcontextprotocol/sdk`.
- `@specsesh/agent/node` stops exporting them and never loads the SDK, statically or dynamically. **BREAKING** for 0.x: import `mcpTools` and `mcpBridge` from `@specsesh/agent/mcp`.
- The four bins keep working without the SDK installed: they load `./mcp` with a dynamic `import()` only when `--mcp`, a tool step on claude-code, or the claude-code pi provider needs it.
- The exports become eleven, `./mcp` after `./node`; docs and the agent readme follow.

## Out of scope

- Bun as a tested runtime (no Bun in CI here); this only removes the module-graph trigger the consumer found.
- Making the MCP SDK a required dependency.
- Changing what `mcpTools` or `mcpBridge` do.

## Capabilities

- **Modified:**
  - `package/distribution`;
  - `actions/mcp`;
  - `pi/claude-code`.

## Impact

- `packages/agent/src/node/{mcp,mcp-bridge}.ts` move to `src/mcp/`; `src/node/index.ts` drops the re-exports; `src/bin/{models,tools,agentscript-pi}.ts` import `../mcp/index.js` lazily.
- `packages/agent/package.json` gains `./mcp`; tests under `__tests__/package/` (manifest, layers, pack) and `__tests__/node/mcp*.test.ts` follow.
- Docs: `packages/agent/README.md`, `docs/llm/agent.md`, `docs/providers/claude-code.md`, `CLAUDE.md`, error messages in `src/claude-code/`.
- Release 0.4.4.
