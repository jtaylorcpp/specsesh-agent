## 1. Session and crash tests

- [x] 1.1 In `packages/agent/__tests__/pi/claude-code-sessions.test.ts`, with the existing fake bridge and scripted runner: "Scenario: Calls one after another share one process", "Scenario: Results for calls made together are all handed back", "Scenario: A process that exits while a call is held ends the session". Test only; if one fails, the fix in `src/claude-code/provider-session.ts` is in scope
- [x] 1.2 `packages/agent/__tests__/fixtures/tools/crash-echo.mjs`, and the fake `claude` in `__tests__/durable/claude-code-tools.test.ts` gaining the transcript answer, `$FAKE_CLAUDE_LOG` and exit-on-MCP-failure (`design.md` decision 1). In that file: "Scenario: A claude-code run killed during a tool call resumes", "Scenario: A durable claude-code run calls a --tools tool"

## 2. The live check

- [x] 2.1 `packages/agent/__tests__/live/claude-code-tools.live.test.ts` (decision 2): "Scenario: Tool-step isolation costs what safe mode costs", "Scenario: A project CLAUDE.md does not reach a tool step", "Scenario: A real claude calls a bridged tool", "Scenario: A real durable run records its call". `test:claude-code` scripts in the root and `packages/agent` `package.json`. `pnpm test` must not run it (the default config already excludes `__tests__/live`)
- [x] 2.2 Docs: `CLAUDE.md` Commands gains `pnpm test:claude-code` (opt-in, your subscription, skips without a logged-in `claude`); `packages/agent/docs/providers/claude-code.md` "Tool steps" says to run it after updating Claude Code; `openspec/parked.md` "Back to `--safe-mode` on tool steps" names it as the re-check. Run `pnpm docs:check`, `pnpm check`, `pnpm test`

The change ends with the principal's agent running `pnpm test:claude-code` once and recording the result in `design.md` under "Verified live", then `pnpm change close add-claude-code-tool-tests`.
