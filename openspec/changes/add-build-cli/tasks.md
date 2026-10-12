## 1. The command

- [ ] 1.1 `packages/agent/src/task/build-cli.ts` (new): `runBuild(args, config, io)`: the flags, the dirty-tree and guard refusals, and the text output
- [ ] 1.2 `packages/agent/src/bin/agentscript-task.ts`: the `build` command with its usage line and exit codes, and `answer` routing a change loop to `answerChangeEscalation`
- [ ] 1.3 `packages/agent/src/task/status.ts`: `build <group>` for a change loop, and `loopKind` knows change loops
- [ ] 1.4 `packages/agent/src/task/draft-cli.ts`: a converged draft ends with `pnpm task build <change>`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/status.test.ts`: update "No command prints usage" (1)
- [ ] 2.2 `packages/agent/__tests__/task/cli-build.test.ts`: "A build runs every group in order", "A dirty tree refuses build" and "A refused guard exits 2" (3)
- [ ] 2.3 `packages/agent/__tests__/task/cli-build-output.test.ts`: "status shows the build's group", "Answering a blocked build continues it", "A blocked build prints the answer command" and "A built change points at archiving" (4)
- [ ] 2.4 `packages/agent/__tests__/task/cli-draft-output.test.ts`: update "A drafted change points at execution" to expect `pnpm task build add-plan-export` (1)

## 3. Docs

- [ ] 3.1 `packages/agent/README.md`: `build` in the CLIs section, with the session from the design
- [ ] 3.2 `guides/07-task-loop.md`: `build` executes a whole change; `run <change> <group>` and `--next-group` run one group

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-build-cli`
