## 1. Amendments in the loop model

- [x] 1.1 In `packages/agent/src/openspec/loops.ts`, add `Amendment` `{ delta, text }` and an optional `Escalation.amendment`, and reject `"amendment-applied"` unless `amendment` is present and `by` is `"principal"`
- [x] 1.2 In `packages/agent/__tests__/openspec/loops.test.ts`, test "An escalation can go to an agent", "Only the named recipient answers" and "amendment-applied needs an amendment"

## 2. The amend_path and amend_text contract

- [x] 2.1 In `packages/agent/src/task/scripts/task.agent`, declare `amend_path` and `amend_text` as `mutable string = ""` and add the amend-spec paragraph to the judge step's instructions
- [x] 2.2 In `packages/agent/src/task/scripts/task-delegate.agent`, declare `amend_path` and `amend_text` as `mutable string = ""` and add the amend-spec paragraph to the judge step's instructions
- [x] 2.3 In `packages/agent/src/task/loop.ts`, add `amend_path` to every child run's `choices`: `""`, then `specs/<capability path>/spec.md` for each delta in the order of `deltas`
- [x] 2.4 In `packages/agent/src/task/contract.ts`, require `amend_path` and `amend_text` as strings, and refuse a script whose `amend_path` default is not among its choices
- [x] 2.5 In `packages/agent/__tests__/task/contract.test.ts`, test "A script missing amend_path is refused" and "A default outside the values is refused"
- [x] 2.6 In `packages/agent/__tests__/task/bundled-judges.test.ts`, test "The judge prompt asks for the whole file", "The judge step's schema lists the three values" and "The judge step's schema lists the change's deltas"

## 3. Blocking with an amendment and answering it

- [x] 3.1 In `packages/agent/src/task/judge.ts`, on `"amend-spec"` set `escalation.amendment` from `amend_path` and `amend_text`, or omit it and note `amendment dropped: <variable> is empty`
- [x] 3.2 In `packages/agent/src/task/answer.ts`, accept `"amendment-applied"` and seed `carried` with `The principal applied your amendment to <delta>. That delta now reads:`, a blank line, then the text
- [x] 3.3 In `packages/agent/__tests__/task/loop.test.ts`, test "A met verdict is read back", "A task loop escalates", "An amend-spec verdict blocks with a spec defect" and "An empty amend_text drops the amendment"
- [x] 3.4 In `packages/agent/__tests__/task/answer.test.ts`, test "The wrong recipient is rejected", "A principal's answer resumes the loop", "An applied amendment is carried" and "A blocked task loop resumes with the answer"
