## 1. The command

- [x] 1.1 `packages/agent/src/task/change-state.ts` (new): `changeState(harness, change)`: the change's latest draft loop, and what it waits for
- [x] 1.2 `packages/agent/src/task/cmd-draft.ts` (new): `draft`: start, continue, answer with feedback, and its refusals
- [x] 1.3 `packages/agent/src/task/change-output.ts` (new): the draft output and its next commands
- [x] 1.4 `packages/agent/src/bin/agentscript-change.ts` (new): the `draft` command, usage, settings resolved as in `agentscript-task`, and exit codes
- [x] 1.5 `packages/agent/package.json`: `bin` gains `agentscript-change` at `./dist/bin/agentscript-change.js`, and `__tests__/package/manifest.test.ts` expects four bins in "The bins are wired to compiled files"
- [x] 1.6 `package.json`: a `change` script that runs `packages/agent/dist/bin/agentscript-change.js`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/change/cli-usage.test.ts`: "No command prints usage", "An unknown command prints usage", "A new change starts at the proposal" and "A new change without an intent is refused" (4)
- [ ] 2.2 `packages/agent/__tests__/change/cli-draft.test.ts`: "An edited design redrafts from the design", "A fully approved change starts nothing", "Feedback redrafts the stage under review" and "Feedback answers a stage's question" (4)
- [ ] 2.3 `packages/agent/__tests__/change/cli-output.test.ts`: "draft alone shows what is waiting", "A review ends with both commands", "A question exits 1" and "A drafted change points at the next step" (4)

## 3. Docs

- [ ] 3.1 `guides/09-spec-agent.md`: start with `pnpm change draft`, and keep `pnpm task spec` for rerunning one stage

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-change-draft`
