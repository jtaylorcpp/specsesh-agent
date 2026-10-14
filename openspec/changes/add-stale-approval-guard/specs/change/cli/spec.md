## ADDED Requirements

### Requirement: build refuses approved files that changed
Before starting or answering (with an answer or `--amend`) a change loop, `build <change>` SHALL compare every approved file with its sha256 in `approvals.json`, by `draft`'s comparison, which hashes `tasks.md` with each `- [x]` read as `- [ ]` so ticks are no change. On a mismatch or missing file it SHALL exit `2`, starting and answering nothing. It SHALL run after argument parsing and `--amend`'s refusals, before the dirty-tree check.

#### Scenario: A hand-edited delta refuses a new build
- **GIVEN** `add-plan-export` with its four stages approved, no change loop waiting, and `specs/plan/export/spec.md` edited after the specs were approved
- **WHEN** `build add-plan-export` runs
- **THEN** the exit code SHALL be `2` and no change loop SHALL exist

#### Scenario: Answering a waiting build is refused
- **GIVEN** `add-plan-export` blocked asking `Which API?`, and `design.md` edited after the design was approved
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** the exit code SHALL be `2`, no loop SHALL be answered, and the latest change loop SHALL still be `blocked` asking `Which API?`

#### Scenario: An uncommitted hand edit gets the stale refusal, not the dirty-tree one
- **GIVEN** `add-plan-export` with `specs/plan/export/spec.md` edited after approval and not committed
- **WHEN** `build add-plan-export` runs without `--allow-dirty`, and again with `--allow-dirty`
- **THEN** both runs SHALL print the stale-approval refusal, neither SHALL name `--allow-dirty`, and both SHALL exit `2` with no loop started

#### Scenario: Ticked tasks are not a change
- **GIVEN** `add-plan-export` blocked asking `Which API?` after its build ticked `- [x] 1.1` and `- [x] 1.2` in `tasks.md`, with no other edit since approval
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** no stale-approval refusal SHALL be printed and the blocked loop SHALL be answered with decision `Use the v2 API`

#### Scenario: Files approved again pass the check
- **GIVEN** `add-plan-export` blocked asking `Which API?`, `specs/plan/export/spec.md` edited, then `draft add-plan-export` and `approve add-plan-export` run until every stage is approved
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** the blocked loop SHALL be answered with decision `Use the v2 API` and no stale-approval refusal SHALL be printed

### Requirement: build checks nothing when it starts nothing
`build <change>` SHALL NOT run the stale-approval check when it starts nothing: without an answer or `--amend` on a change whose latest change loop is `blocked`, where it prints the question as before, or on a change whose latest change loop converged, where it says the change is built.

#### Scenario: A blocked build still shows its question after a hand edit
- **GIVEN** `add-plan-export` blocked asking `Which API?`, and `specs/plan/export/spec.md` edited after approval
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL contain `Which API?`, no stale-approval refusal SHALL be printed, no loop SHALL start, and the exit code SHALL be `1`

#### Scenario: A built change still says it is built after a hand edit
- **GIVEN** `add-plan-export` whose latest change loop converged, and `design.md` edited after approval
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL say it is built, no stale-approval refusal SHALL be printed, and no loop SHALL start

### Requirement: The stale-approval refusal names each file and the next step
The refusal SHALL go to stderr: `<change>: approved files changed since they were approved; build refused`, then `  <stage>: <path> (changed|missing)` per mismatched file, the path relative to the change and `missing` for a deleted file, grouped in stage order proposal, design, specs, tasks and sorted by path within a stage, then `review it with: pnpm change draft <change>` and `then approve it again: pnpm change approve <change>`.

#### Scenario: One changed delta
- **GIVEN** `add-plan-export` with only `specs/plan/export/spec.md` changed since approval
- **WHEN** `build add-plan-export` runs
- **THEN** stderr SHALL be exactly `add-plan-export: approved files changed since they were approved; build refused`, `  specs: specs/plan/export/spec.md (changed)`, `review it with: pnpm change draft add-plan-export`, `then approve it again: pnpm change approve add-plan-export`

#### Scenario: Several stages and a deleted file
- **GIVEN** `add-plan-export` blocked, with `design.md` and `specs/plan/export/spec.md` changed and `specs/plan/schema/spec.md` deleted since approval
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** stderr SHALL list, in order, `  design: design.md (changed)`, `  specs: specs/plan/export/spec.md (changed)`, `  specs: specs/plan/schema/spec.md (missing)`, between the refusal line and the two next-step lines

### Requirement: --amend checks approvals before it writes
`build <change> --amend` SHALL run the stale-approval check over every approved stage on the files as they are before its write, the delta it amends included. A refusal SHALL write nothing, print no `amended` line, run no validation or trial fold, answer no loop, and exit `2`.

#### Scenario: --amend over a hand-edited delta is refused
- **GIVEN** `add-plan-export` blocked on an escalation carrying an `Amendment` for `specs/plan/export/spec.md`, and that file edited by hand after approval
- **WHEN** `build add-plan-export --amend` runs
- **THEN** stderr SHALL contain `  specs: specs/plan/export/spec.md (changed)`, the output SHALL contain no `amended` line, the file SHALL hold its hand-edited bytes, no validation SHALL run, and the exit code SHALL be `2`

#### Scenario: --amend is refused over a changed non-spec stage
- **GIVEN** `add-plan-export` blocked on an escalation carrying an `Amendment`, and `tasks.md` edited after the tasks were approved
- **WHEN** `build add-plan-export --amend` runs
- **THEN** stderr SHALL contain `  tasks: tasks.md (changed)`, nothing SHALL be written, the loop SHALL stay `blocked`, and the exit code SHALL be `2`

### Requirement: A passing --amend records the delta's approval
When `--amend`'s validation passes, `build` SHALL set the delta's sha256 in the specs approval in `approvals.json` to the hash of the bytes written, with the principal (`git config user.name`, then `$USER`) and the note `amendment-applied`, and print `approved <delta> as <principal>: amendment-applied`, before answering the loop. All other entries and approvals SHALL stay byte-for-byte the same, and the file's format SHALL NOT change.

#### Scenario: The amended delta is approved before the build resumes
- **GIVEN** `add-plan-export` blocked on task `2.2`'s escalation carrying an `Amendment` for `specs/plan/export/spec.md` that passes validation, and `git config user.name` `jesse`
- **WHEN** `build add-plan-export --amend` runs and the build converges
- **THEN** the specs approval SHALL record for `specs/plan/export/spec.md` the sha256 of `text`, by `jesse`, with note `amendment-applied`, and every other entry of `approvals.json` SHALL be unchanged
- **AND** the output SHALL contain, in order, `amended openspec/changes/add-plan-export/specs/plan/export/spec.md`, `## validation: passed`, `approved specs/plan/export/spec.md as jesse: amendment-applied`, `resumed task 2.2 with decision: amendment-applied` and `# add-plan-export — built`

#### Scenario: The principal falls back to $USER
- **GIVEN** no `git config user.name`, `$USER` `jesse`, and an `Amendment` that passes validation
- **WHEN** `build add-plan-export --amend` runs
- **THEN** the output SHALL contain `approved specs/plan/export/spec.md as jesse: amendment-applied`

#### Scenario: An amended delta passes the next check
- **GIVEN** `build add-plan-export --amend` passed, and the resumed build ended blocked asking `Which API?`
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** no stale-approval refusal SHALL be printed and the loop SHALL be answered with decision `Use the v2 API`

### Requirement: A failed --amend records no approval
When `--amend`'s validation fails, `approvals.json` SHALL be unchanged and no `approved` line printed. When recording the approval fails, `build` SHALL answer no loop, leave the delta holding `text`, and exit `2`; the change loop SHALL stay `blocked`, and a later `build <change> --amend` SHALL be refused as stale.

#### Scenario: Failed validation leaves approvals.json unchanged
- **GIVEN** an `Amendment` to `add-plan-export` that `openspec validate --all --strict` reports as an `[ERROR]`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** `approvals.json` SHALL hold exactly its bytes from before the command, the output SHALL contain no `approved` line, the loop SHALL stay `blocked`, and the exit code SHALL be `2`

#### Scenario: A failed recording resumes nothing
- **GIVEN** an `Amendment` to `add-plan-export` that passes validation, and `approvals.json` that cannot be written
- **WHEN** `build add-plan-export --amend` runs
- **THEN** no loop SHALL be answered, the change loop SHALL stay `blocked`, `specs/plan/export/spec.md` SHALL hold `text`, and the exit code SHALL be `2`
- **AND** running `build add-plan-export --amend` again SHALL print `  specs: specs/plan/export/spec.md (changed)` and exit `2`
