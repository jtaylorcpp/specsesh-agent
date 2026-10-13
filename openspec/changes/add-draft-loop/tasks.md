## 1. The loop

- [x] 1.1 `packages/agent/src/task/draft-input.ts` (new): `DraftLoopOptions`, `DraftOutcome` and the checkpoint `{ phase, stage?, child?, entries }` as TypeBox schemas
- [x] 1.2 `packages/agent/src/task/draft-loop.ts` (new): the `agentscript.draft-loop` task with its phases `next`, `stage` and `answer`
- [x] 1.3 `packages/agent/src/task/draft-api.ts` (new): `startDraftLoop`, `waitForDraftLoop`, `answerDraftLoop` and `draftLoopExtensions`
- [x] 1.4 `packages/agent/src/task/index.ts`: export the draft loop's functions and types

## 2. Tests

- [x] 2.1 `packages/agent/__tests__/task/draft-loop.test.ts`: "A host starts and awaits a draft loop", "A fully approved change converges at once" and "An edited approved file reopens its stage" (3)
- [x] 2.2 `packages/agent/__tests__/task/draft-stage.test.ts`: "A review blocks the draft", "An exhausted stage fails the draft", "Killed while a stage drafts" and "An already approved proposal is entered with runs 0" (4)
- [x] 2.3 `packages/agent/__tests__/task/draft-answer.test.ts`: "Approving the proposal drafts the design", "A revision redrafts the same stage" and "An agent cannot approve through the draft" (3)

## 3. Docs

- [x] 3.1 `guides/09-spec-agent.md`: a "Draft a whole change" section with the design's example

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-draft-loop`
