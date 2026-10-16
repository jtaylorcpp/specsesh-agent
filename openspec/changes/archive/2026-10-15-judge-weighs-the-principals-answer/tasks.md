## 1. Scripts

- [x] 1.1 In `packages/agent/src/task/scripts/task.agent`, show the carried text in the judge step when `carried` is non-empty, and tell the judge an answer settles the question it answers
- [x] 1.2 In `packages/agent/src/task/scripts/task-delegate.agent`, do the same in its judge step

## 2. Tests

- [x] 2.1 Test in `packages/agent/__tests__/task/carried-scripts.test.ts` "task.agent's judge sees an answer on a resumed run's first iteration", "task-delegate.agent's judge sees an answer on a resumed run's first iteration", and extend "A fresh run's first iteration shows no carried line" to the judge prompts

## 3. Checks

- [x] 3.1 Run `pnpm check`
- [x] 3.2 Run `pnpm test`
- [x] 3.3 Run `pnpm spec:check`
