## 1. Judge script and contract

- [x] 1.1 In `packages/agent/src/task/scripts/group.agent` declare `amend_path` and `amend_text` as strings set from the structured result, and add the judge instruction "when the spec delta itself is wrong, set `amend-spec`…"
- [x] 1.2 In `packages/agent/src/task/group-api.ts` make the `startGroupLoop` judge contract check require `amend_path` and `amend_text` as `string`, rejecting with the missing variable's name
- [x] 1.3 In `packages/agent/__tests__/task/group-script.test.ts` test "The bundled judge script is clean", "The bundled judge reworks first" and "The bundled judge is told how to amend a delta"
- [x] 1.4 In `packages/agent/__tests__/task/group-entry.test.ts` test "A script without rework_task is refused" and "A script without amend_path is refused"

## 2. Judge read-back and amend_path choices

- [x] 2.1 In `packages/agent/src/task/group-judge.ts` pass `amend_path` choices (`""` then each delta in `deltas` order) beside the `next_action` choices on every judge run
- [x] 2.2 In `packages/agent/src/task/group-judge.ts` read `amend_path` and `amend_text` back and build `Amendment { delta, text }` unchanged, only when `next_action` is `amend-spec`
- [x] 2.3 In `packages/agent/__tests__/task/group-judge.test.ts` test "An amend-spec verdict yields an Amendment", "ask ignores the amendment variables" and "The amend_path choices list the change's deltas"

## 3. Escalation carries the amendment

- [x] 3.1 In `packages/agent/src/task/group.ts` set `escalation.amendment` on `amend-spec` blocks, or omit it and record `amendment dropped: <variable> is empty` when `amend_path` is empty or `amend_text` blank
- [x] 3.2 In `packages/agent/__tests__/task/group-judge.test.ts` test "The judge asks the principal", "The escalation carries the judge's amendment", "A blank amend_text drops the amendment" and "An empty amend_path drops the amendment"

## 4. Resume on amendment-applied

- [x] 4.1 In `packages/agent/src/task/group-answer.ts` re-read the change's deltas from disk before the rerun check when a judge block with `amendment` is answered `amendment-applied`, without adding to `reworks`
- [x] 4.2 In `packages/agent/__tests__/task/group-answer.test.ts` test "Answering a blocked task resumes the group" and "An applied amendment converges the group"
- [x] 4.3 In `packages/agent/__tests__/task/group-answer.test.ts` test "A still-failing check after an amendment goes to the judge with the new deltas" and "amendment-applied on a block without an amendment is a plain judge answer"
