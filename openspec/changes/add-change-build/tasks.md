## 1. The command

- [x] 1.1 `packages/agent/src/task/change-state.ts`: the change's newest change loop, and whether it is waiting, built or ready
- [x] 1.2 `packages/agent/src/task/cmd-build.ts` (new): `build`: the flags, `--change-check`, the refusals, start, and answer
- [x] 1.3 `packages/agent/src/task/change-output.ts`: the build output; a drafted change ends with `pnpm change build <change>`
- [x] 1.4 `packages/agent/src/bin/agentscript-change.ts`: the `build` command, its usage line and its exit codes

## 2. Tests

- [x] 2.1 `packages/agent/__tests__/change/cli-usage.test.ts`: update "No command prints usage" (1)
- [x] 2.2 `packages/agent/__tests__/change/cli-build.test.ts`: "A build runs every group in order", "A dirty tree refuses build", "A refused guard exits 2" and "A built change starts nothing" (4)
- [x] 2.3 `packages/agent/__tests__/change/cli-answer.test.ts`: "Answering a waiting build continues it", "build alone shows the question", "A blocked build ends with the answer command" and "A built change points at the next step" (4)
- [x] 2.4 `packages/agent/__tests__/change/cli-output.test.ts`: update "A drafted change points at the next step" to expect `pnpm change build add-plan-export` (1)

## 3. Docs

- [x] 3.1 `guides/07-task-loop.md`: `pnpm change build` executes a whole change; `pnpm task <change> <group>` runs one group
- [x] 3.2 `guides/09-spec-agent.md`: end the walkthrough with `pnpm change build`

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-change-build`
