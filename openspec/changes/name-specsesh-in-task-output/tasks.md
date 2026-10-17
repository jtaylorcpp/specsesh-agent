## 1. The wording

- [ ] 1.1 `packages/agent/src/bin/agentscript-task.ts`: the usage lines, every `loop <id> — resume with:` hint and every answer line name `specsesh task`, as the specs delta says
- [ ] 1.2 `packages/agent/src/task/spec-cli.ts`: the review, question and next-step lines, `allApproved`, the slice lines and the resume hint name `specsesh task`
- [ ] 1.3 `packages/agent/src/task/resume-all.ts`: the answer line names `specsesh task answer`
- [ ] 1.4 Root `package.json`: `task` is `node packages/specsesh/bin/specsesh.js task`; delete `scripts/task.mjs`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/cli.test.ts` and `status.test.ts`: "The resume hint is the first stderr line", "A converged loop prints its iterations and ticked", "A blocked loop ends with the answer command", "An unknown command prints usage", and "No command prints usage" expect `specsesh task`, and `status.test.ts`: "status is a command" (6)
- [ ] 2.2 `packages/agent/__tests__/task/spec-cli.test.ts`, `cli-spec-review.test.ts`, `group-cli.test.ts` and `resume-all.test.ts`: "A converged group prints its tasks", "A review prints both commands", "The last approval points at execution", "Approving a sliced proposal lists the other slices", "A blocked root ends with the answer command" and "Nothing to resume" expect `specsesh task` (6)
- [ ] 2.3 `packages/agent/__tests__/task/cli-specsesh.test.ts` (new): "The spec resume hint names specsesh task", "A blocked group ends with the specsesh answer command" and "The task usage names no old command" (3)
- [ ] 2.4 `packages/agent/__tests__/repo/config.test.ts`: "The database directory is ignored", "pnpm task runs specsesh task" and "The old task bin prints the specsesh usage", replacing the test of `scripts/task.mjs` (3)
- [ ] 2.5 Every other test under `packages/agent/__tests__/` that asserts an `agentscript-task <command>` or `pnpm task …` line the task CLI prints (`status.test.ts`, `cli-group.test.ts`, `cli-helpers.ts`, `events.test.ts`, `resolve.test.ts`, `change/cli-output.test.ts`, `task/change-output.test.ts`) expects `specsesh task`

## 3. Verify

- [ ] 3.1 `pnpm check`, `pnpm test` and `pnpm spec:check` pass
