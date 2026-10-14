## 1. The amendment module

- [x] 1.1 Export the trial fold in `packages/agent/src/task/cmd-close.ts` as `trialFold(change, root)`, returning pass or fail with its output, and have `close` call it with unchanged behaviour
- [x] 1.2 Create `packages/agent/src/task/amend.ts` with `amendmentTarget` (refuse absolute, `..`, non-`specs/**/spec.md`), `unifiedDiff` and `applyAmendment` (save bytes, write, validate, `trialFold`, restore or delete on any error or warning)

## 2. Showing and applying the amendment in build

- [x] 2.1 In `packages/agent/src/task/change-output.ts`, when the escalation has an `Amendment`, print `## proposed amendment (from <asker>): <delta>` and `unifiedDiff` before the question and `--amend` before the answer line
- [x] 2.2 In `packages/agent/src/task/cmd-build.ts`, add the `amend` option: refuse with exit `2`, run `applyAmendment`, print `## validation: passed` or `failed`, then answer with `amendment-applied` and print the run
- [x] 2.3 In `packages/agent/src/bin/agentscript-change.ts`, parse `--amend` for `build`, pass it to the build command, and add `[<answer>|--amend]` after `<change>` in the `build` usage line

## 3. Tests for usage, output and text answers

- [x] 3.1 Add fixtures to `packages/agent/__tests__/change/helpers.ts` seeding a change loop blocked on a task-loop or group-judge escalation with an `Amendment`, and a fake `openspec` for validate and archive
- [x] 3.2 Update `packages/agent/__tests__/change/cli-usage.test.ts` for the new `build` usage line, covering "No command prints usage" and "An unknown command prints usage"
- [x] 3.3 Extend `packages/agent/__tests__/change/cli-output.test.ts` to cover "A blocked build ends with the answer command", "A blocked build with an amendment ends with both commands" and "A built change points at the next step"
- [x] 3.4 Extend `packages/agent/__tests__/change/cli-answer.test.ts` to cover "A task loop's amendment is shown as a diff", "A group judge's amendment names the judge" and "A text answer writes and validates nothing"

## 4. Tests for --amend

- [x] 4.1 Create `packages/agent/__tests__/change/cli-amend.test.ts` covering "--amend with an answer is refused", "--amend with no amendment waiting is refused", "A delta outside specs/ is refused" and "A passing amendment resumes the task loop"
- [x] 4.2 Extend `packages/agent/__tests__/change/cli-amend.test.ts` to cover "A passing amendment resumes the group judge" and "An error restores the uncommitted delta"
- [x] 4.3 Extend `packages/agent/__tests__/change/cli-amend.test.ts` to cover "A warning alone fails the validation" and "A failed amendment that created a file deletes it"
