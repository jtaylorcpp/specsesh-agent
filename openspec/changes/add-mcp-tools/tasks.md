## 1. The dependency and the fixture

- [ ] 1.1 Add `@modelcontextprotocol/sdk` (`design.md` decision 7): `packages/agent/package.json` dev `1.32.1`, peer `^1.32.1` with `optional: true`; `packages/specsesh/package.json` dependency `1.32.1`; `pnpm install`. `__tests__/package/layers.test.ts`: `src/node` may import it. `manifest.test.ts` follows the modified requirements. Tests: "Scenario: The specsesh manifest is exact", "Scenario: Every peer is optional", "Scenario: The layer graph holds", "Scenario: Only the node layer speaks MCP". `pnpm pack:check` still passes
- [ ] 1.2 `packages/agent/__tests__/fixtures/mcp/server.mjs`: an `McpServer` with `echo`, `add` (with `outputSchema`), `fail`, `tags` (required array) and one read-only idempotent tool, over stdio when run, or exporting a `startHttp()` on port 0 that records request headers; `CRASH=1` exits before the handshake (`design.md` "Testing")

## 2. mcpTools

- [ ] 2.1 `packages/agent/src/node/mcp.ts`: `mcpTools`, `McpServerError`, `mapTool` and the config types (`design.md` decisions 1–5), exported from `src/node/index.ts`. Tests in `__tests__/node/mcp.test.ts`: "Scenario: A stdio server's tool becomes an action", "Scenario: An HTTP server's tool runs", "Scenario: close ends the stdio process", "Scenario: A crashing server is named", "Scenario: A header takes its token from the environment", "Scenario: A missing variable is named"
- [ ] 2.2 Mapping. In `__tests__/node/mcp.test.ts`: "Scenario: Structured outputs are read from structuredContent", "Scenario: A tool with an array parameter is skipped", "Scenario: An error result is a failed call", "Scenario: Annotations choose kind and replay"

## 3. The CLIs

- [ ] 3.1 `packages/agent/src/bin/tools.ts`: `--mcp` files read, checked, merged and passed to `mcpTools`, the actions joined with `--tools` in one registry, and the skipped lines (`design.md` decision 6). `agentscript-pi.ts` wires it and closes in `finally`. Tests in `__tests__/pi/cli.test.ts`: "Scenario: A script calls an MCP tool", "Scenario: A file without mcpServers is refused", "Scenario: A server that will not start is refused"
- [ ] 3.2 `agentscript-durable.ts`: `--mcp` on both commands, closed after the harness, repeated in the resume hint. Tests in `__tests__/durable/cli.test.ts`: "Scenario: A durable run calls an MCP tool", "Scenario: A resume without the MCP file is refused"

## 4. Docs

- [ ] 4.1 `docs/llm/agent.md` and `docs/llm/durable.md`: `--mcp`, `<server>/<tool>` naming, the mapping rules (required scalar inputs only; `text` or structured outputs), and that an existing `.mcp.json` works. README `## Run it once`: a `--mcp .mcp.json` line. `CLAUDE.md`'s `src/node` row names `mcp.ts`. `openspec/parked.md`: optional MCP parameters. Run `pnpm docs:check`, `pnpm check`, `pnpm test`, `pnpm pack:check`, and run a script once live against a real stdio MCP server on Ollama, recording it in `design.md` under "Verified live"

The change ends with `pnpm change close add-mcp-tools`.
