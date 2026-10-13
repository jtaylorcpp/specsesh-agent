## 1. The command

- [x] 1.1 `packages/agent/src/task/cmd-approve.ts` (new): `approve` with `--principal` and its refusals
- [x] 1.2 `packages/agent/src/task/cmd-draft.ts`: refuse the feedback `approve`, naming `pnpm change approve <change>`
- [x] 1.3 `packages/agent/src/task/change-output.ts`: the review lines end with `pnpm change approve <change>`; slices list `pnpm change draft` commands
- [x] 1.4 `packages/agent/src/bin/agentscript-change.ts`: the `approve` command and its usage line

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/change/cli-usage.test.ts`: update "No command prints usage" (1)
- [ ] 2.2 `packages/agent/__tests__/change/cli-approve.test.ts`: "Approving the proposal drafts the design", "A question cannot be approved", "Nothing to approve is refused" and "approve is not feedback" (4)
- [ ] 2.3 `packages/agent/__tests__/change/cli-output.test.ts`: update "A review ends with both commands" and add "Approving a sliced proposal lists draft commands" (2)

## 3. Docs

- [ ] 3.1 `packages/agent/README.md`: `pnpm change draft` and `approve` in the CLIs section, with the session from `add-change-draft`'s design

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-change-approve`
