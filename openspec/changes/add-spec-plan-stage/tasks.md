## 1. The stage

- [x] 1.1 `packages/agent/src/task/stages/tasks-gate.ts` (new): `readTaskList`, `withClaims`, `unclaimed` and the size filter
- [x] 1.2 `packages/agent/src/task/scripts/spec-plan.agent` (new): the script from the design's example
- [x] 1.3 `packages/agent/src/task/options.ts`: `BUNDLED_SCRIPTS.specPlan`
- [x] 1.4 `packages/agent/src/task/stages/tasks.ts` (new): `tasksStage` with its seed and gate
- [x] 1.5 `packages/agent/src/task/spec-stages.ts`: `SPEC_STAGES` gains `tasksStage`
- [x] 1.6 `packages/agent/src/task/index.ts`: export `tasksStage`

## 2. Tests

- [x] 2.1 `packages/agent/__tests__/task/stages/tasks-gate.test.ts`: "A ticked task is sent back", "A task naming two files is sent back", "An unclaimed scenario is sent back" and "Thirteen tasks are sent back" (4)
- [x] 2.2 `packages/agent/__tests__/task/stages/tasks-stage.test.ts`: "The tasks stage is seeded with the repository's files", "The bundled plan script fits the contract" and "The design follows the proposal" (3)

## 3. Docs

- [ ] 3.1 `guides/09-spec-agent.md` (new): the spec agent guide the design outlines
- [ ] 3.2 `guides/README.md`: guide 09 in the paths table and the list

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-spec-plan-stage`
