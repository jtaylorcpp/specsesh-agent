## 1. The amendment module

- [ ] 1.1 Create `packages/agent/src/task/amend.ts` exporting `amendmentTarget(changeDir, delta)`, which returns `<changeDir>/<delta>`, or a refusal when the normalised delta is absolute, has a `..` segment, or is not `specs/**/spec.md`
- [ ] 1.2 Add `unifiedDiff(path, before, after)` to `packages/agent/src/task/amend.ts`. It prints `--- <path> (on disk)`, `+++ <path> (amended)`, `@@` hunks and `-`/`+` lines, and treats a missing file as empty
- [ ] 1.3 Add `applyAmendment` to `packages/agent/src/task/amend.ts`: save the bytes or note absence, write `text`, validate like `close` (`--all --strict`, then `cmd-close.ts`'s trial fold), restore or delete on any failure

## 2. Showing and applying the amendment in build

- [ ] 2.1 In `packages/agent/src/task/change-output.ts`, when a blocked escalation has an `Amendment`, print `## proposed amendment (from <loop>): <delta>`, the `unifiedDiff` against disk, the question and both answer lines
- [ ] 2.2 In `packages/agent/src/task/cmd-build.ts`, handle the `amend` option: refuse with exit `2`, call `applyAmendment`, then answer the blocked loop with `amendment-applied` through `answerEscalation` or `answerGroupEscalation` and print the run
- [ ] 2.3 In `packages/agent/src/bin/agentscript-change.ts`, parse `--amend` for `build`, pass it to `cmd-build`, and add `[<answer>|--amend]` after `<change>` in the `build` usage line
- [ ] 2.4 Update `packages/agent/__tests__/change/cli-usage.test.ts` for the new `build` usage line, covering "No command prints usage" and "An unknown command prints usage"

## 3. Tests for showing and answering

- [ ] 3.1 Add fixtures to `packages/agent/__tests__/change/helpers.ts` that seed a blocked change loop whose task-loop or group-judge escalation carries an `Amendment`, plus a fake `openspec validate` with a set exit code and output
- [ ] 3.2 Extend `packages/agent/__tests__/change/cli-answer.test.ts` to cover "Answering a waiting build continues it", "build alone shows the question" and "A text answer to an amendment writes nothing"
- [ ] 3.3 Extend `packages/agent/__tests__/change/cli-output.test.ts` to cover "A task loop's amendment is shown as a diff", "A group judge's amendment names the judge" and "An escalation without an amendment shows no diff"

## 4. Tests for --amend

- [ ] 4.1 Create `packages/agent/__tests__/change/cli-amend.test.ts` covering "--amend with an answer is refused", "--amend with no amendment waiting is refused", "A delta outside specs is refused" and "A valid amendment resumes the task loop"
- [ ] 4.2 Extend `packages/agent/__tests__/change/cli-amend.test.ts` to cover "A valid amendment resumes the group judge", "An error restores the exact bytes", "A warning alone fails the check" and "A file the amendment created is deleted"
