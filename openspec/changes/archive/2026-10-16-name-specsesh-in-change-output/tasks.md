## 1. The wording

- [x] 1.1 `packages/agent/src/bin/agentscript-change.ts`: the usage lines and the draft and build resume hints name `specsesh change`, as the specs delta says
- [x] 1.2 `packages/agent/src/task/change-output.ts`: every next-command helper (`reviseCmd` to `sliceCmd`) and the stale-approval lines name `specsesh change`
- [x] 1.3 `packages/agent/src/task/cmd-draft.ts`, `cmd-approve.ts` and `cmd-close.ts`: refusals that name a command name `specsesh change`
- [x] 1.4 Root `package.json`: `change` is `node packages/specsesh/bin/specsesh.js change`

## 2. Tests

- [x] 2.1 `packages/agent/__tests__/change/cli-usage.test.ts`, `cli-approve.test.ts` and `cli-draft.test.ts`: "No command prints usage", "An unknown command prints usage", "approve is not feedback", "Approving the proposal drafts the design", "A question cannot be approved", "Nothing to approve is refused", "Feedback redrafts the stage under review" and "Feedback answers a stage's question" expect `specsesh change` (8)
- [x] 2.2 `packages/agent/__tests__/change/cli-output.test.ts`: "draft alone shows what is waiting", "A review ends with both commands", "A question exits 1", "A drafted change points at the next step", "Approving a sliced proposal lists draft commands", "A blocked build ends with the answer command", "A blocked build with an amendment ends with both commands" and "A built change points at the next step" expect `specsesh change` (8)
- [x] 2.3 `packages/agent/__tests__/change/cli-build.test.ts` and `cli-answer.test.ts`: "A hand-edited delta refuses a new build" and "Several stages and a deleted file are listed in order" expect `specsesh change`, and the other scenarios of "build refuses stale approvals before starting or continuing" keep passing (2)
- [x] 2.4 `packages/agent/__tests__/change/cli-specsesh.test.ts` (new): "The draft resume hint names specsesh change", "The build resume hint names specsesh change", "close names the build to run again" and "The usage names no old command" (4)
- [x] 2.5 `packages/agent/__tests__/change/cli-specsesh-bin.test.ts` (new): "The old bin prints the specsesh usage" and "pnpm change runs specsesh change" (2)
- [x] 2.6 Every other test under `packages/agent/__tests__/` that asserts a `pnpm change …` or `agentscript-change <command>` line it prints (`task/change-output.test.ts`, `task/cmd-draft.test.ts`, `task/cmd-approve.test.ts`, `change/cli-amend.test.ts`) expects `specsesh change`

## 3. Verify

- [x] 3.1 `pnpm check`, `pnpm test` and `pnpm spec:check` pass
