## 1. The command

- [ ] 1.1 `packages/agent/src/task/spec-cli.ts` (new): `runSpec(args, config, io)`: stage choice, `intent.md`, refusals, and the text output
- [ ] 1.2 `packages/agent/src/task/spec-stages.ts` (new): `SPEC_STAGES`, holding `proposalStage`
- [ ] 1.3 `packages/agent/src/bin/agentscript-task.ts`: the `spec` command, the usage lines, and the exit codes
- [ ] 1.4 `packages/agent/src/bin/agentscript-task.ts`: `answer` routes a spec loop to `answerSpecLoop` with `--principal`
- [ ] 1.5 `packages/agent/src/task/status.ts`: `spec <stage>` for a spec loop

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/status.test.ts`: update "No command prints usage" and add "A spec loop waiting for review exits 0" (2)
- [ ] 2.2 `packages/agent/__tests__/task/cli-spec.test.ts`: "A new change starts at the proposal", "A new change without an intent is refused" and "A dirty tree does not refuse spec" (3), faux provider
- [ ] 2.3 `packages/agent/__tests__/task/cli-spec-review.test.ts`: "status shows the stage", "answer approves with the git name", "A review prints both commands" and "The last approval points at execution" (4)

## 3. Docs

- [ ] 3.1 `packages/agent/README.md`: `spec` in the CLIs section, with the session from the design

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-spec-cli`
