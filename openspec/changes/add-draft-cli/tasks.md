## 1. The command

- [ ] 1.1 `packages/agent/src/task/draft-cli.ts` (new): `runDraft(args, config, io)`: the intent, the refusal of a change awaiting an answer, and the text output
- [ ] 1.2 `packages/agent/src/bin/agentscript-task.ts`: the `draft` command, its usage line and its exit codes
- [ ] 1.3 `packages/agent/src/bin/agentscript-task.ts`: `answer` routes a draft loop to `answerDraftLoop` and prints the new run as `draft` does
- [ ] 1.4 `packages/agent/src/task/status.ts`: `draft <stage>` for a draft loop, and `loopKind` knows draft loops

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/status.test.ts`: update "No command prints usage" and add "A draft loop waiting for review exits 0" (2)
- [ ] 2.2 `packages/agent/__tests__/task/cli-draft.test.ts`: "A new change is drafted from its proposal", "A change awaiting review is refused", "status shows the draft's stage" and "Approving through answer moves on" (4)
- [ ] 2.3 `packages/agent/__tests__/task/cli-draft-output.test.ts`: "A review prints both commands for the draft", "A drafted change points at execution" and "Approving a sliced proposal lists draft commands" (3)

## 3. Docs

- [ ] 3.1 `packages/agent/README.md`: `draft` in the CLIs section, with the session from the design
- [ ] 3.2 `guides/09-spec-agent.md`: start with `draft`, and keep `spec` for rerunning one stage

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-draft-cli`
