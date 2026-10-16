## 1. Scripts

- [x] 1.1 In `packages/agent/src/task/scripts/task.agent`, show the carried text in orient when `carried` is non-empty, not only after iteration 1
- [x] 1.2 In `packages/agent/src/task/scripts/task-delegate.agent`, show the carried text and its "If the carried feedback names a check" line when `carried` is non-empty

## 2. Tests

- [x] 2.1 Test in `packages/agent/__tests__/task/carried-scripts.test.ts` "task.agent shows an answer on a resumed run's first iteration", "task-delegate.agent shows an answer on a resumed run's first iteration", "A fresh run's first iteration shows no carried line"
- [x] 2.2 In `packages/agent/__tests__/task/e2e.test.ts`, match the carried line's new wording
- [x] 2.3 In `packages/agent/__tests__/task/action-retry.test.ts`, match the carried line's new wording

## 3. Parked

- [x] 3.1 In `openspec/parked.md`, note that the spec-stage scripts gate carried feedback on `iteration > 1`

## 4. Checks

- [x] 4.1 Run `pnpm check`
- [x] 4.2 Run `pnpm test`
- [x] 4.3 Run `pnpm spec:check`
