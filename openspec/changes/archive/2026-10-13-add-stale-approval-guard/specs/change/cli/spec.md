## ADDED Requirements

### Requirement: build refuses stale approvals before starting or continuing
Before `build <change>` starts a change loop, or an answer or `--amend` answers a `blocked` one, it SHALL compare each approved file with its sha256 in `approvals.json` as `draft` does; recorded and compared hashes read each `- [x]` in `tasks.md` as `- [ ]`. A mismatch SHALL print the stale-approval refusal to stderr, exit `2`, start or answer nothing. It SHALL follow `--amend`'s argument refusals and precede the dirty-tree check. Showing a question or reporting built SHALL NOT check.

#### Scenario: A hand-edited delta refuses a new build
- **GIVEN** `add-plan-export` with its four stages approved, no change loop waiting, and `specs/plan/export/spec.md` edited after the specs approval
- **WHEN** `build add-plan-export` runs
- **THEN** stderr SHALL be `add-plan-export: approved files changed since they were approved; build refused`, `  specs: specs/plan/export/spec.md (changed)`, `review it with: pnpm change draft add-plan-export` and `then approve it again: pnpm change approve add-plan-export`, in that order
- **AND** the exit code SHALL be `2`, and no change loop SHALL exist

#### Scenario: An answer to a waiting build is refused and the loop stays blocked
- **GIVEN** `add-plan-export` blocked asking `Which API?`, and `design.md` edited after the design approval
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** stderr SHALL contain the stale-approval refusal with `  design: design.md (changed)`, and the exit code SHALL be `2`
- **AND** no loop SHALL be answered, and the latest change loop SHALL still be `blocked` asking `Which API?`

#### Scenario: Ticked tasks are not a change
- **GIVEN** `add-plan-export` with its four stages approved, blocked asking `Which API?` after the build ticked tasks `1.1` and `1.2` in `tasks.md` from `- [ ]` to `- [x]`, and no other edit to any approved file
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** no stale-approval refusal SHALL be printed, and the loop SHALL be answered with decision `Use the v2 API`

#### Scenario: --allow-dirty does not get around the refusal
- **GIVEN** `add-plan-export` with an uncommitted hand edit to the approved `specs/plan/export/spec.md`
- **WHEN** `build add-plan-export --allow-dirty` runs
- **THEN** stderr SHALL contain the stale-approval refusal with `  specs: specs/plan/export/spec.md (changed)`, the exit code SHALL be `2`, and no loop SHALL start

#### Scenario: Showing the question does not check
- **GIVEN** `add-plan-export` blocked asking `Which API?`, and `specs/plan/export/spec.md` edited after the specs approval
- **WHEN** `build add-plan-export` runs with no answer
- **THEN** the output SHALL contain `Which API?` and not the stale-approval refusal, no loop SHALL start, and the exit code SHALL be `1`

#### Scenario: A built change does not check
- **GIVEN** `add-plan-export` whose latest change loop converged, and `design.md` edited after the design approval
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL say it is built and not contain the stale-approval refusal, and no loop SHALL start

#### Scenario: Redrafting and approving again lets the build continue
- **GIVEN** `add-plan-export` blocked asking `Which API?`, with `specs/plan/export/spec.md` edited, then `draft add-plan-export` and `approve add-plan-export` run until every stage is approved
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** no stale-approval refusal SHALL be printed, and the loop SHALL be answered with decision `Use the v2 API`

### Requirement: The stale-approval refusal names each file and the next step
The refusal SHALL be `<change>: approved files changed since they were approved; build refused`, then one line `  <stage>: <path> (changed|missing)` per stale file, `<path>` relative to the change directory and `missing` when the recorded file no longer exists, grouped in the order proposal, design, specs, tasks and sorted by path within a stage, then `review it with: pnpm change draft <change>` and `then approve it again: pnpm change approve <change>`.

#### Scenario: Several stages and a deleted file are listed in order
- **GIVEN** `add-plan-export` blocked asking `Which API?`, with `design.md` and `specs/plan/export/spec.md` edited and `specs/plan/schema/spec.md` deleted after their approvals
- **WHEN** `build add-plan-export "Use the v2 API"` runs
- **THEN** stderr SHALL be, in order, `add-plan-export: approved files changed since they were approved; build refused`, `  design: design.md (changed)`, `  specs: specs/plan/export/spec.md (changed)`, `  specs: specs/plan/schema/spec.md (missing)`, `review it with: pnpm change draft add-plan-export` and `then approve it again: pnpm change approve add-plan-export`
- **AND** the exit code SHALL be `2`

### Requirement: --amend refuses a hand-edited change before writing
`build <change> --amend` SHALL run the stale-approval check on the files as they are before its write, the delta it would amend included. On a refusal it SHALL print no `amended` line, write nothing, run no validation or trial fold, leave `approvals.json` unchanged and the change loop `blocked`, and exit `2`.

#### Scenario: --amend over a hand-edited delta is refused
- **GIVEN** `add-plan-export` blocked on task `2.2`'s escalation carrying an `Amendment` for `specs/plan/export/spec.md`, and that file edited by hand after the specs approval
- **WHEN** `build add-plan-export --amend` runs
- **THEN** stderr SHALL contain the stale-approval refusal with `  specs: specs/plan/export/spec.md (changed)`, and the output SHALL NOT contain `amended`
- **AND** the file SHALL hold its hand-edited bytes, no validation SHALL run, the change loop SHALL still be `blocked`, and the exit code SHALL be `2`

### Requirement: A passing --amend records the delta's approval
When `--amend`'s validation passes, it SHALL, before answering the loop, set the delta's sha256 in the specs approval of `approvals.json` to the hash of the bytes written, by the principal (`git config user.name`, else `$USER`) with the note `amendment-applied`, and print `approved <delta> as <principal>: amendment-applied`. Every other entry and approval SHALL stay byte-for-byte the same. If recording fails, it SHALL resume nothing, leave the delta written, and exit `2`.

#### Scenario: A passing amendment updates only its entry
- **GIVEN** `add-plan-export` blocked on task `2.2`'s escalation carrying an `Amendment` for `specs/plan/export/spec.md` that passes validation, and `git config user.name` `jesse`
- **WHEN** `build add-plan-export --amend` runs and the build converges
- **THEN** the specs approval SHALL record the sha256 of `text` for `specs/plan/export/spec.md`, by `jesse`, with the note `amendment-applied`, and `approvals.json` SHALL be otherwise byte-for-byte unchanged
- **AND** the output SHALL contain, in order, `amended openspec/changes/add-plan-export/specs/plan/export/spec.md`, `## validation: passed`, `approved specs/plan/export/spec.md as jesse: amendment-applied` and `resumed task 2.2 with decision: amendment-applied`
- **AND** a following `build add-plan-export` SHALL say it is built, without the stale-approval refusal

#### Scenario: The principal falls back to $USER
- **GIVEN** an `Amendment` to `add-plan-export` that passes validation, no `git config user.name`, and `$USER` `jesse`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** the output SHALL contain `approved specs/plan/export/spec.md as jesse: amendment-applied`

#### Scenario: A failed recording resumes nothing
- **GIVEN** an `Amendment` to `add-plan-export` for `specs/plan/export/spec.md` that passes validation, and `approvals.json` that cannot be written
- **WHEN** `build add-plan-export --amend` runs
- **THEN** the output SHALL NOT contain `resumed`, no loop SHALL be answered, the file SHALL hold `text`, and the exit code SHALL be `2`
- **AND** running `build add-plan-export --amend` again SHALL print the stale-approval refusal with `  specs: specs/plan/export/spec.md (changed)`

#### Scenario: A failed validation records nothing
- **GIVEN** an `Amendment` to `add-plan-export` that `openspec validate --all --strict` reports as an `[ERROR]`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** `approvals.json` SHALL be byte-for-byte unchanged, the output SHALL NOT contain `approved`, the change loop SHALL still be `blocked`, and the exit code SHALL be `2`

## MODIFIED Requirements

### Requirement: --amend writes, validates, then resumes
`build <change> --amend` SHALL write `text` to `openspec/changes/<change>/<delta>`, print `amended <path>`, run `openspec validate --all --strict` and, if so, `close`'s trial fold, with `OPENSPEC_TELEMETRY=0`, and print `## validation: passed` or `failed`. Each passes only on exit `0` with no error or warning. On pass, after recording its approval, it SHALL answer the loop with decision `amendment-applied`, print `resumed <asker> with decision: amendment-applied`, then the new run.

#### Scenario: A passing amendment resumes the task loop
- **GIVEN** `add-plan-export` blocked on task `2.2`'s escalation carrying an `Amendment` for `specs/plan/export/spec.md` that passes validation
- **WHEN** `build add-plan-export --amend` runs and the build converges
- **THEN** the file SHALL hold `text`; `openspec validate --all --strict` SHALL have run, then `openspec archive add-plan-export --yes` and `openspec validate --specs --strict` in a temporary copy of `openspec/`, all with `OPENSPEC_TELEMETRY=0`; and `openspec/changes/add-plan-export/` SHALL not be archived in the repository
- **AND** the output SHALL contain, in order, `amended openspec/changes/add-plan-export/specs/plan/export/spec.md`, `## validation: passed`, `resumed task 2.2 with decision: amendment-applied` and `# add-plan-export — built`
- **AND** task `2.2` SHALL be answered through `answerEscalation` with decision `amendment-applied`, and the exit code SHALL be `0`

#### Scenario: A passing amendment resumes the group judge
- **GIVEN** `add-csv-import` blocked on group `1`'s judge escalation carrying an `Amendment` that passes validation
- **WHEN** `build add-csv-import --amend` runs
- **THEN** group `1`'s judge SHALL be answered through `answerGroupEscalation` with decision `amendment-applied`
- **AND** the output SHALL contain `resumed group 1 judge with decision: amendment-applied`

#### Scenario: A text answer writes and validates nothing
- **GIVEN** `add-plan-export` blocked on an escalation carrying an `Amendment`
- **WHEN** `build add-plan-export "Keep JSON, drop the sort"` runs
- **THEN** `openspec/changes/add-plan-export/<delta>` SHALL be unchanged, no validation and no trial fold SHALL run, and the loop SHALL be answered with decision `Keep JSON, drop the sort`
