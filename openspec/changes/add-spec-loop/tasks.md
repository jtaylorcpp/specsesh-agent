## 1. The loop

- [ ] 1.1 `packages/agent/src/task/spec-stage.ts` (new): `SpecStage`, `StageContext`, `StageIssue`, `owns(stage, path)`, and the stage contract with its checker
- [ ] 1.2 `packages/agent/src/task/spec-bundle.ts` (new): `readBundle(text, stage)` returning the owned files and the write issues
- [ ] 1.3 `packages/agent/src/task/spec-loop.ts` (new): the `agentscript.spec-loop` task, its four phases and its `Iteration` records
- [ ] 1.4 `packages/agent/src/task/spec-api.ts` (new): `startSpecLoop`, `waitForSpecLoop` and `specLoopExtensions`
- [ ] 1.5 `packages/agent/src/task/index.ts`: export the four spec modules' public names

## 2. Tests

- [ ] 2.1 `packages/agent/__tests__/task/spec-bundle.test.ts`: "A stage owning a directory", "Two files in one bundle", "A file the stage does not own" and "An empty bundle" (4)
- [ ] 2.2 `packages/agent/__tests__/task/spec-loop.test.ts`: "A script without files is refused", "A next_action default outside the choices is refused", "A crash during await starts no second run" and "The current files are re-read each iteration"
- [ ] 2.3 `packages/agent/__tests__/task/spec-loop-gate.test.ts`: "An issue is fixed on the second iteration", "Issues every time exhaust the budget", "A clean draft waits for review" and "The stage asks a question" (4)

## 3. Docs

- [ ] 3.1 `CLAUDE.md`: a "Spec loop" paragraph under Layout naming the four modules and the stage contract

## 4. Verify

- [ ] 4.1 `pnpm check`, `pnpm test`, `pnpm spec:check` and `pnpm docs:check` pass
- [ ] 4.2 `pnpm spec:archive add-spec-loop`
