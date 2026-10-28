## 1. The signal

- [ ] 1.1 `signal` on `ClaudeCodeReasoningPortOptions` and in `createClaudeCodeReasoningPort` (`design.md` decisions 1–6), in `packages/agent/src/claude-code/claude-code.ts`. Tests in a new `__tests__/pi/claude-code-abort.test.ts` (`design.md` "Testing"): "Scenario: An aborted signal starts nothing", "Scenario: Aborting a text step kills claude", "Scenario: Aborting a tool step closes the bridge", "Scenario: A call after the abort never reaches the host"
- [ ] 1.2 Docs: `packages/agent/docs/llm/agent.md` (the claude-code port bullet) and `packages/agent/docs/providers/claude-code.md` (a sentence under "Tool steps" and the port's options), and the claude-code port's module comment. Run `pnpm docs:check`, `pnpm check`, `pnpm test`

The change ends with `pnpm change close add-claude-code-abort`.
