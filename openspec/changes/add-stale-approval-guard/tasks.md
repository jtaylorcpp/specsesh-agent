## 1. Stale-approval check in build

- [x] 1.1 In `packages/agent/src/task/spec-approvals.ts`, export a function listing stale files (stage, path, changed|missing) of every approved stage, built on the per-stage comparison `draft` uses to pick its redraft stage
- [x] 1.2 In `packages/agent/src/task/change-output.ts`, add the stale-approval refusal formatter: refusal line, `  <stage>: <path> (changed|missing)` in stage then path order, then the `draft` and `approve` next-step lines
- [ ] 1.3 In `packages/agent/src/task/cmd-build.ts`, run the stale check after argument parsing and before the dirty-tree check when starting or answering a loop, printing the refusal to stderr and exiting 2; skip it on show-question and built
- [ ] 1.4 In `packages/agent/__tests__/change/cli-build.test.ts`, test "A hand-edited delta refuses a new build", "An uncommitted hand edit gets the stale refusal, not the dirty-tree one", "One changed delta"
- [ ] 1.5 In `packages/agent/__tests__/change/cli-answer.test.ts`, test "Answering a waiting build is refused", "Files approved again pass the check", "Several stages and a deleted file"
- [ ] 1.6 In `packages/agent/__tests__/change/cli-build.test.ts`, test "A blocked build still shows its question after a hand edit", "A built change still says it is built after a hand edit", "Ticked tasks are not a change"

## 2. Approval-aware --amend

- [ ] 2.1 In `packages/agent/src/task/spec-approvals.ts`, export a function setting one file's sha256 in the specs approval with a principal and note, leaving every other entry and approval byte-for-byte unchanged
- [ ] 2.2 In `packages/agent/src/task/amend.ts`, run the stale check after the existing argument refusals and before writing, and on any stale file print the refusal to stderr, write nothing, run no validation, and exit 2
- [ ] 2.3 In `packages/agent/src/task/amend.ts`, after validation passes record the delta via 2.1 with the `approve` default principal and note `amendment-applied`, print the `approved` line, then answer; on record failure answer nothing and exit 2
- [ ] 2.4 In `packages/agent/__tests__/change/cli-amend.test.ts`, test "--amend over a hand-edited delta is refused", "--amend is refused over a changed non-spec stage", "Failed validation leaves approvals.json unchanged"
- [ ] 2.5 In `packages/agent/__tests__/change/cli-amend.test.ts`, test "The amended delta is approved before the build resumes", "The principal falls back to $USER"
- [ ] 2.6 In `packages/agent/__tests__/change/cli-amend.test.ts`, test "An amended delta passes the next check", "A failed recording resumes nothing"
