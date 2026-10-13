## 1. Approvals and answers

- [x] 1.1 `packages/agent/src/task/spec-approvals.ts` (new): the `approvals.json` schema, `readApprovals`, `recordApproval` (replace, then drop dependants) and `staleApprovals(stage, changeDir)`
- [x] 1.2 `packages/agent/src/task/spec-stage.ts`: `SpecStage.after`
- [x] 1.3 `packages/agent/src/task/spec-loop.ts`: the `approve` phase for a run started with `approve: true`
- [x] 1.4 `packages/agent/src/task/spec-answer.ts` (new): `answerSpecLoop`, routing approve, revise and question answers
- [x] 1.5 `packages/agent/src/task/spec-api.ts`: refuse a start whose `after` stages are unapproved or stale
- [x] 1.6 `packages/agent/src/task/index.ts`: export `answerSpecLoop`

## 2. Tests

- [x] 2.1 `packages/agent/__tests__/task/spec-review.test.ts`: "Approving the proposal", "Re-approving the proposal drops the design's approval", "A revision reaches the next draft" and "An answered question is carried, even \"approve\"" (4)
- [x] 2.2 `packages/agent/__tests__/task/spec-order.test.ts`: "An agent cannot approve a stage", "Designing before the proposal is approved is refused", "An edited approved file is refused" and "A malformed approvals file refuses the start" (4)

## 3. Docs

- [ ] 3.1 `CLAUDE.md`: the spec loop paragraph gains approvals, `after` and the revise path

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-spec-review`
