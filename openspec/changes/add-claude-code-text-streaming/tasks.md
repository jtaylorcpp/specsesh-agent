## 1. Streaming the port

- [x] 1.1 `packages/agent/src/claude-code/claude-code.ts`: `ClaudeInvocation.stream` and the argv swap in `claudeArgs` (decision 2), `Runner`'s optional `onStdout` and `spawnIn` calling it (decision 3), the stream-json line reader (decision 4), settling from the result line (decision 5), and `reason`/`runToolStep` streaming exactly when given a sink (decisions 1 and 6). Tests in a new `__tests__/pi/claude-code-stream.test.ts`: "Scenario: A listening text step streams its text", "Scenario: A step with no listener keeps the json argv", "Scenario: A listening step's argv swaps only the output format", "Scenario: A structured step settles from the result line", "Scenario: A streamed max-turns result is cut short", "Scenario: A stream with no result line fails", "Scenario: spawnRunner passes stdout on before exit", "Scenario: A runner that ignores onStdout still settles"
- [x] 1.2 Tool steps: "Scenario: A listening tool step streams text and its call" in `__tests__/pi/claude-code-stream.test.ts`, with the fake bridge the tool tests use. Check the existing claude-code tests still pass unchanged

## 2. Live check and docs

- [ ] 2.1 "Scenario: A real claude streams a step's text" in `__tests__/live/claude-code-tools.live.test.ts` (skips without a logged-in `claude`, like its neighbours; not run by `pnpm test`)
- [ ] 2.2 Docs: `packages/agent/docs/llm/agent.md` (the claude-code bullets: a listening run streams text), `packages/agent/docs/providers/claude-code.md` (streaming: when it happens, the flags, structured steps stream no text, the pi provider doesn't stream), the port's module comment in `claude-code.ts`, and the `--provider claude-code` paragraph of `CLAUDE.md`. Park "claude-code pi provider text streaming (held sessions, durable runs)" in `openspec/parked.md`, replacing the existing claude-code text streaming entry. Run `pnpm docs:check`, `pnpm check`, `pnpm test`

The change ends with `pnpm change close add-claude-code-text-streaming`.
