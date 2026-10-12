## 1. The command

- [ ] 1.1 `packages/agent/src/task/cmd-close.ts` (new): `close`: the guard, the trial fold in a temporary copy, and the archive
- [ ] 1.2 `packages/agent/src/task/change-output.ts`: the close output; a built change ends with `pnpm change close <change>`
- [ ] 1.3 `packages/agent/src/bin/agentscript-change.ts`: the `close` command and its usage line
- [ ] 1.4 `packages/agent/README.md`: name `agentscript-change` among the bins, and add `close` to the change CLI section

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/change/cli-usage.test.ts`: update "No command prints usage" (1)
- [ ] 2.2 `packages/agent/__tests__/change/cli-close.test.ts`: "An unticked task refuses close", "A waiting build refuses close", "A finished change is folded" and "A fold that breaks the specs is refused" (4)
- [ ] 2.3 `packages/agent/__tests__/change/cli-answer.test.ts`: update "A built change points at the next step" to expect `pnpm change close add-plan-export` (1)
- [ ] 2.4 `packages/agent/__tests__/package/manifest.test.ts`: update "The bins are wired to compiled files" and "Every entry is documented" for four bins (2)

## 3. Docs

- [ ] 3.1 `guides/09-spec-agent.md`: end the walkthrough with `pnpm change close`
- [ ] 3.2 `CLAUDE.md`: closing a change is `pnpm change close <id>`; `pnpm spec:archive` stays for this repo's own use

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm change close add-change-close`
