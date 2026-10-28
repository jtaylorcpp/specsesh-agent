## 1. Sessions in the provider

- [ ] 1.1 `claudeCodeProvider`'s `bridge` option and the bridged path (`design.md` decisions 1 and 2), with the session in `packages/agent/src/claude-code/provider-session.ts`. Tests in a new `__tests__/pi/claude-code-sessions.test.ts`, with a fake bridge and a scripted runner (`design.md` "Testing"): "Scenario: A bridged request starts one session", "Scenario: Only submit_result is not bridged", "Scenario: An unservable name starts nothing". In `__tests__/pi/claude-code-provider.test.ts`: "Scenario: Two tools are refused", "Scenario: A test runner replaces spawning", "Scenario: The provider runs claude in its cwd option"
- [ ] 1.2 Held calls and continuing (decisions 2 and 3). In `__tests__/pi/claude-code-sessions.test.ts`: "Scenario: A held call is handed out, answered and continued", "Scenario: Calls made together arrive in one message", "Scenario: An error result reaches claude as an error", "Scenario: A structured answer ends as a submit_result call", "Scenario: A resumed transcript goes to a fresh process"
- [ ] 1.3 Signals (decision 4). In the same file: "Scenario: Aborting kills the held process"

## 2. The bins and docs

- [ ] 2.1 `src/bin/models.ts`: `cliModels` registers `claudeCodeProvider({ bridge: mcpBridge() })`. `agentscript-durable.ts`: remove the claude-code tools usage line (decision 5). In a new `__tests__/durable/claude-code-tools.test.ts`, with a fake `claude` on `PATH` that calls the first allowed tool over MCP, like the one in `__tests__/pi/cli.test.ts`, and the real provider (no `vi.mock`): "Scenario: A durable claude-code run calls a --tools tool", "Scenario: The usage no longer refuses claude-code tools"
- [ ] 2.2 Docs: `docs/llm/durable.md` and `docs/llm/agent.md` (drop "Not durable yet"); `docs/providers/claude-code.md` (durable tool steps: held sessions, crash behaviour, and the Limits bullet); `CLAUDE.md` (the claude-code pi provider bullet, and the "Not on durable runs yet" sentence). Run `pnpm docs:check`, `pnpm check`, `pnpm test`, `pnpm pack:check`

The change ends with a live check by the principal's agent: `examples/tools` run durably on `--provider claude-code`, plus a run killed mid-step and resumed. It is recorded in `design.md` under "Verified live". Then `pnpm change close add-durable-claude-code-tools`.
