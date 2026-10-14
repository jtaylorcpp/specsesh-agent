## 1. Stale-approval check in build

- [ ] 1.1 In `packages/agent/src/task/spec-approvals.ts`, export a stale-file list (stage, path, changed|missing) over every approved stage via `draft`'s per-stage comparison, hashing `tasks.md` with each `- [x]` read as `- [ ]`
- [ ] 1.2 In `packages/agent/src/task/change-output.ts`, add the stale-approval refusal formatter: refusal line, `  <stage>: <path> (changed|missing)` in stage then path order, then the `draft` and `approve` next-step lines
- [ ] 1.3 In `packages/agent/src/task/cmd-build.ts`, before the dirty-tree check, refuse a new loop or a text answer to a blocked one when any file is stale: refusal to stderr, exit 2; skip it on show-question and built
- [ ] 1.4 In `packages/agent/__tests__/change/cli-build.test.ts`, test "A hand-edited delta refuses a new build", "--allow-dirty does not get around the refusal", "Showing the question does not check", "A built change does not check"
- [ ] 1.5 In `packages/agent/__tests__/change/cli-answer.test.ts`, test "An answer to a waiting build is refused and the loop stays blocked", "Several stages and a deleted file are listed in order"
- [ ] 1.6 In `packages/agent/__tests__/change/cli-answer.test.ts`, test "Ticked tasks are not a change", "Redrafting and approving again lets the build continue"

## 2. Approval-aware --amend

- [ ] 2.1 In `packages/agent/src/task/spec-approvals.ts`, export a function setting one file's sha256 in the specs approval with a principal and note, leaving every other entry and approval byte-for-byte unchanged
- [ ] 2.2 In `packages/agent/src/task/amend.ts`, run the stale check after the existing argument refusals and before writing; on any stale file print the refusal to stderr, write nothing, run no validation, and exit 2
- [ ] 2.3 In `packages/agent/src/task/amend.ts`, after validation passes record the delta via 2.1 with the `approve` default principal and note `amendment-applied`, print the `approved` line, then answer; on record failure exit 2
- [ ] 2.4 In `packages/agent/__tests__/change/cli-amend.test.ts`, test "--amend over a hand-edited delta is refused", "A failed validation records nothing", "A failed recording resumes nothing"
- [ ] 2.5 In `packages/agent/__tests__/change/cli-amend.test.ts`, test "A passing amendment updates only its entry", "The principal falls back to $USER", "A passing amendment resumes the task loop"
- [ ] 2.6 In `packages/agent/__tests__/change/cli-amend.test.ts`, test "A passing amendment resumes the group judge", "A text answer writes and validates nothing"
