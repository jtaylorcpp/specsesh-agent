## 1. The loop

- [ ] 1.1 `packages/agent/src/task/change-input.ts` (new): `ChangeLoopOptions` with `changeChecks`, and the checkpoint `{ phase, queue, entries, child? }`
- [ ] 1.2 `packages/agent/src/task/change-guard.ts` (new): `buildRefusal(change, changeDir)`: strict validation and the approvals check; `unclaimedAtStart` by quoted name
- [ ] 1.3 `packages/agent/src/task/change-loop.ts` (new): the `agentscript.change-loop` task with its phases `next`, `group` and `check`
- [ ] 1.4 `packages/agent/src/task/change-api.ts` (new): `startChangeLoop`, `waitForChangeLoop`, `answerChangeEscalation` and `changeLoopExtensions`
- [ ] 1.5 `packages/agent/src/task/index.ts`: export the change loop's functions and `ChangeLoopOptions`

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/change-loop.test.ts`: "A host starts and awaits a change loop", "A finished group is checked, not rebuilt", "Killed during a group" and "An unclaimed scenario is reported" (4)
- [ ] 2.2 `packages/agent/__tests__/task/change-guard.test.ts`: "An invalid change refuses the build", "An edited approved tasks.md refuses the build" and "A hand-written change builds" (3)
- [ ] 2.3 `packages/agent/__tests__/task/change-groups.test.ts`: "A blocked group blocks the change", "A failed group ends the change", "A failing change check fails the change" and "Answering a blocked group resumes the change" (4)

## 3. Docs

- [ ] 3.1 `docs/ontology/loops/change-loop.md`: name `agentscript.change-loop` as its implementation, and say its change check reworks nothing yet
- [ ] 3.2 `guides/07-task-loop.md`: a "Build a whole change" section with the design's example

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-build-loop`
