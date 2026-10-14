# change/cli Specification

## Purpose
The change CLI: `agentscript-change`, run as `pnpm change`, whose commands are what happens to a change (draft, approve, build, close). Each is addressed by change id, finds the change's loop itself, and ends with the command to run next.

## Requirements

### Requirement: agentscript-change takes a command and a change
`agentscript-change` SHALL take a command and a change id under the config's `changesDir`. Any other command, or none, MUST print usage to stderr and exit `2`, one line per command as the scenario "No command prints usage" lists them. It SHALL resolve the database, provider and model as `agentscript-task` does, read no stdin, never prompt, and exit `2` on a refusal.

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]`, `agentscript-change approve <change> [--principal <name>] [--db <path>]`, `agentscript-change build <change> [<answer>|--amend] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]` and `agentscript-change close <change> [--db <path>]`

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate add-plan-export`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: draft starts or continues a change's draft
With no draft loop of the change waiting for an answer, `draft <change>` SHALL start a draft loop over `SPEC_STAGES` and print it. A missing change needs `--intent` or `--intent-file`; its directory is created with `intent.md` holding the words. Without either, `--intent` on an existing change, or feedback with nothing waiting SHALL exit `2`. With every stage approved, nothing SHALL start.

#### Scenario: A new change starts at the proposal
- **WHEN** `draft add-plan-export --intent "Export a plan"` runs and the change does not exist
- **THEN** `intent.md` SHALL hold `Export a plan`, and the draft's first spec loop SHALL be the proposal's

#### Scenario: A new change without an intent is refused
- **WHEN** `draft add-plan-export` runs and the change does not exist
- **THEN** it SHALL exit `2` naming `--intent`, and create nothing

#### Scenario: An edited design redrafts from the design
- **GIVEN** a change whose four stages are approved, and `design.md` edited afterwards
- **WHEN** `draft add-plan-export` runs
- **THEN** the draft's first spec loop SHALL be the design's

#### Scenario: A fully approved change starts nothing
- **GIVEN** a change whose four stages are approved and unchanged
- **WHEN** `draft add-plan-export` runs
- **THEN** no loop SHALL start, the output SHALL say every stage is approved, and the exit code SHALL be `0`

### Requirement: draft with feedback answers what is waiting
When the change's latest draft loop ended `blocked`, `draft <change> <feedback>` SHALL answer it with the feedback as the principal's decision, wait for the new run and print it. Feedback that is `approve`, trimmed and in any case, SHALL exit `2` naming `pnpm change approve <change>`. Without feedback it SHALL print what is waiting again, start nothing, and exit as that loop did.

#### Scenario: Feedback redrafts the stage under review
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`
- **WHEN** `draft add-plan-export "JSON only"` runs
- **THEN** the proposal's next draft SHALL carry `The principal asked for: JSON only`

#### Scenario: Feedback answers a stage's question
- **GIVEN** `add-plan-export` waiting on the question `CSV too?`
- **WHEN** `draft add-plan-export "No"` runs
- **THEN** the stage SHALL draft again carrying `The principal asked for: No`

#### Scenario: draft alone shows what is waiting
- **GIVEN** `add-plan-export` waiting for review of `design.md`
- **WHEN** `draft add-plan-export` runs
- **THEN** the output SHALL name `design.md`, no loop SHALL start, and the exit code SHALL be `0`

#### Scenario: approve is not feedback
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`
- **WHEN** `draft add-plan-export " Approve "` runs
- **THEN** it SHALL exit `2` naming `pnpm change approve add-plan-export`, and `approvals.json` SHALL be unchanged

### Requirement: Draft output ends with the next command
The output SHALL start `# <change> — <state>`, then `## <stage>: approved` per approved stage, then the current stage's `### <stage> draft <n>` lines. A review SHALL end with its files, `pnpm change draft <change> "<what to change>"` and `pnpm change approve <change>`; a question with it and `pnpm change draft <change> "<answer>"`, exiting `1`; a drafted change with `pnpm change build <change>`.

#### Scenario: A review ends with both commands
- **WHEN** a draft of `add-plan-export` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `pnpm change draft add-plan-export "<what to change>"` and `pnpm change approve add-plan-export`

#### Scenario: A question exits 1
- **WHEN** a draft ends waiting on the question `CSV too?`
- **THEN** the output SHALL end with `CSV too?` and `pnpm change draft add-plan-export "<answer>"`, and the exit code SHALL be `1`

#### Scenario: A drafted change points at the next step
- **WHEN** a draft of `add-plan-export` ends `converged`
- **THEN** the output SHALL end with `pnpm change build add-plan-export`

### Requirement: approve approves the stage under review
`approve <change>` SHALL answer the change's draft loop waiting for review with `approve`, by `principal`, recording `--principal` (default `git config user.name`, then `$USER`), wait for the new run and print it as `draft` does. A change waiting on a question SHALL exit `2` naming `pnpm change draft <change> "<answer>"`; one with nothing under review SHALL exit `2`. The run that approves a proposal with `slices.md` SHALL list `pnpm change draft <id> --intent "<intent>"` per later slice.

#### Scenario: Approving the proposal drafts the design
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`, and `git config user.name` `jesse`
- **WHEN** `approve add-plan-export` runs
- **THEN** `approvals.json` SHALL record the proposal by `jesse`, and the output SHALL end waiting for review of the design

#### Scenario: A question cannot be approved
- **GIVEN** `add-plan-export` waiting on a question
- **WHEN** `approve add-plan-export` runs
- **THEN** it SHALL exit `2` naming `pnpm change draft add-plan-export "<answer>"`, and nothing SHALL start

#### Scenario: Nothing to approve is refused
- **GIVEN** `add-plan-export` with no draft loop waiting
- **WHEN** `approve add-plan-export` runs
- **THEN** it SHALL exit `2` saying nothing is under review

#### Scenario: Approving a sliced proposal lists draft commands
- **GIVEN** `slices.md` with `add-plan-export`, `add-plan-export-schema` and `add-plan-export-ci`
- **WHEN** `approve add-plan-export` approves the proposal
- **THEN** the output SHALL list `pnpm change draft add-plan-export-schema --intent "…"` then `pnpm change draft add-plan-export-ci --intent "…"`

### Requirement: build starts a change's build
With no change loop of the change waiting for an answer, `build <change>` SHALL start a change loop and wait for it, mapping the flags a group run takes, plus `--change-check <command>` (repeatable), onto its options. A dirty tree without `--allow-dirty`, a refusal by the loop's guard, `--worktree`, or an answer with nothing waiting SHALL exit `2` and start nothing. A change whose latest change loop converged SHALL start nothing.

#### Scenario: A build runs every group in order
- **GIVEN** a change with groups `1` and `2`, whose tasks converge on a faux model, and passing checks
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL list group `1` then group `2` as converged, and the exit code SHALL be `0`

#### Scenario: A dirty tree refuses build
- **GIVEN** an uncommitted edit in the repository
- **WHEN** `build add-plan-export` runs without `--allow-dirty`
- **THEN** it SHALL exit `2` naming `--allow-dirty`, and start nothing

#### Scenario: A refused guard exits 2
- **WHEN** `build add-plan-export` runs and a requirement of its deltas has no scenario
- **THEN** it SHALL exit `2` naming that requirement, and no loop SHALL exist

#### Scenario: A built change starts nothing
- **GIVEN** `add-plan-export` whose latest change loop converged
- **WHEN** `build add-plan-export` runs
- **THEN** no loop SHALL start, and the output SHALL say it is built

### Requirement: build with an answer continues a waiting build
When the change's latest change loop ended `blocked`, `build <change> <answer>` SHALL answer it as the escalation's `to` with the answer as the decision, wait for the new run and print it. Without an answer it SHALL print the question again, start nothing, and exit `1`.

#### Scenario: Answering a waiting build continues it
- **GIVEN** `add-plan-export` blocked in group `2` of three, asking `Which API?`
- **WHEN** `build add-plan-export "Use the v2 API"` runs and the build converges
- **THEN** the output SHALL list groups `1`, `2` and `3` as converged

#### Scenario: build alone shows the question
- **GIVEN** `add-plan-export` blocked asking `Which API?`
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL contain `Which API?`, no loop SHALL start, and the exit code SHALL be `1`

### Requirement: Build output ends with the next command
The output SHALL start `# <change> — <state>`, then `## group <n>: <status> (<k> tasks, <r> reworks)` per group entered, then `## change check: passed` or the failing command and its output, then `## unclaimed: <n>` and each scenario when any. A blocked build SHALL end with the question, `pnpm change build <change> --amend` when its escalation carries an amendment, and `pnpm change build <change> "<answer>"`; a built one with `pnpm change close <change>`. Built SHALL exit `0`, else `1`.

#### Scenario: A blocked build ends with the answer command
- **WHEN** a build of `add-plan-export` ends blocked asking `Which API?`, with no amendment
- **THEN** the output SHALL end with `Which API?` and `pnpm change build add-plan-export "<answer>"`

#### Scenario: A blocked build with an amendment ends with both commands
- **WHEN** a build of `add-plan-export` ends blocked on an escalation carrying an `Amendment`, asking `Amend the spec?`
- **THEN** the output SHALL end with `Amend the spec?`, then `pnpm change build add-plan-export --amend`, then `pnpm change build add-plan-export "<answer>"`
- **AND** the exit code SHALL be `1`

#### Scenario: A built change points at the next step
- **WHEN** a build of `add-plan-export` ends `converged`
- **THEN** the output SHALL contain `## change check: passed` and end with `pnpm change close add-plan-export`

### Requirement: close refuses an unfinished change
`close <change>` SHALL exit `2`, changing nothing, for a change with an unticked task in `tasks.md`, listing them; one whose newest change loop in the database ended other than `converged`, naming that loop's state; and one that fails `openspec validate <change> --strict`, naming the first issue.

#### Scenario: An unticked task refuses close
- **GIVEN** `add-plan-export` whose task `2.3` is unticked
- **WHEN** `close add-plan-export` runs
- **THEN** it SHALL exit `2` listing `2.3`, and `openspec/` SHALL be unchanged

#### Scenario: A waiting build refuses close
- **GIVEN** `add-plan-export` whose tasks are all ticked, and whose newest change loop is `blocked`
- **WHEN** `close add-plan-export` runs
- **THEN** it SHALL exit `2` saying the build is waiting for an answer

### Requirement: close folds the change through a trial first
`close` SHALL copy `openspec/` to a temporary directory, run `openspec archive <change> --yes` there and `openspec validate --specs --strict` on the result, and only when both pass run `openspec archive <change> --yes` in the repository, all with `OPENSPEC_TELEMETRY=0`. A failed trial SHALL exit `2` with `openspec/` unchanged. It SHALL print the capabilities folded into and the archive directory, end with `git add -A openspec && git commit`, and SHALL NOT commit.

#### Scenario: A finished change is folded
- **GIVEN** `add-plan-export` with every task ticked, whose newest change loop converged
- **WHEN** `close add-plan-export` runs
- **THEN** its requirements SHALL be in `openspec/specs/`, its directory SHALL be under `openspec/changes/archive/`, and the exit code SHALL be `0`

#### Scenario: A fold that breaks the specs is refused
- **GIVEN** a MODIFIED requirement that passes in the change but is over the length limit once merged
- **WHEN** `close` runs
- **THEN** it SHALL exit `2`, and `openspec/` SHALL be unchanged

### Requirement: build shows a proposed amendment as a diff
When the blocked change loop's escalation carries an `Amendment { delta, text }`, `build <change>` without an answer SHALL print, after the groups and before the question, `## proposed amendment (from <asker>): <delta>`, where `<asker>` is `task <id>` or `group <n> judge`, then a unified diff from `openspec/changes/<change>/<delta>` as on disk, headed `(on disk)`, to `text`, headed `(amended)`. Without an amendment the output SHALL be unchanged.

#### Scenario: A task loop's amendment is shown as a diff
- **GIVEN** `add-plan-export` blocked on task `2.2`'s escalation carrying `Amendment { delta: "specs/plan/export/spec.md", text }`
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL contain `## proposed amendment (from task 2.2): specs/plan/export/spec.md`, then `--- openspec/changes/add-plan-export/specs/plan/export/spec.md (on disk)` and `+++ openspec/changes/add-plan-export/specs/plan/export/spec.md (amended)`, then the hunks from the file on disk to `text`, then the question
- **AND** no loop SHALL start, nothing SHALL be written, and the exit code SHALL be `1`

#### Scenario: A group judge's amendment names the judge
- **GIVEN** `add-csv-import` blocked on group `1`'s judge escalation carrying `Amendment { delta: "specs/plan/import/spec.md", text }`
- **WHEN** `build add-csv-import` runs
- **THEN** the output SHALL contain `## proposed amendment (from group 1 judge): specs/plan/import/spec.md`

### Requirement: --amend refuses what it cannot apply
`build <change> --amend` SHALL exit `2`, changing nothing, when the change's latest change loop is not `blocked`, when the escalation it is blocked on carries no `Amendment`, printing `<change> is not waiting on an amendment`, when an answer is also given, printing `--amend takes no answer: use either --amend or "<answer>"`, or when `delta`, normalised, is absolute, has a `..` segment or does not match `specs/**/spec.md`, printing `amendment delta "<delta>" is not specs/**/spec.md`.

#### Scenario: --amend with an answer is refused
- **GIVEN** `add-plan-export` blocked on an escalation carrying an `Amendment`
- **WHEN** `build add-plan-export --amend "Use v2"` runs
- **THEN** it SHALL print `--amend takes no answer: use either --amend or "<answer>"` and exit `2`
- **AND** no file SHALL be written, no validation SHALL run, and no loop SHALL start

#### Scenario: --amend with no amendment waiting is refused
- **GIVEN** `add-other-thing` blocked on an escalation that carries no `Amendment`
- **WHEN** `build add-other-thing --amend` runs
- **THEN** it SHALL print `add-other-thing is not waiting on an amendment` and exit `2`, and no loop SHALL start

#### Scenario: A delta outside specs/ is refused
- **GIVEN** `add-bad-path` blocked on an escalation carrying `Amendment { delta: "tasks.md", text }`
- **WHEN** `build add-bad-path --amend` runs
- **THEN** it SHALL print `amendment delta "tasks.md" is not specs/**/spec.md` and exit `2`
- **AND** `openspec/changes/add-bad-path/tasks.md` SHALL be unchanged and no loop SHALL start

### Requirement: --amend writes, validates, then resumes
`build <change> --amend` SHALL write `text` to `openspec/changes/<change>/<delta>`, print `amended <path>`, run `openspec validate --all --strict` and, if that passes, `close`'s trial fold, with `OPENSPEC_TELEMETRY=0`, and print `## validation: passed` or `failed`. Each passes only on exit `0` with no error or warning. On pass it SHALL answer the blocked loop as an answer would, with decision `amendment-applied`, print `resumed <asker> with decision: amendment-applied`, then the new run.

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

### Requirement: A failed --amend restores the delta
When validation fails, `build <change> --amend` SHALL print the validation output, put back the bytes `openspec/changes/<change>/<delta>` held before the write, or delete the file if it did not exist, print `restored <path>` and `nothing resumed`, answer no loop, and exit `2`. The change loop SHALL stay `blocked`. The bytes SHALL be saved in memory before the write, not taken from git.

#### Scenario: An error restores the uncommitted delta
- **GIVEN** `specs/plan/export/spec.md` of `add-plan-export` with an uncommitted edit, and an `Amendment` adding a requirement 534 characters long, which `openspec validate --all --strict` reports as an `[ERROR]`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** the output SHALL contain `## validation: failed`, the validation output naming the error, `restored openspec/changes/add-plan-export/specs/plan/export/spec.md` and `nothing resumed`, and the trial fold SHALL not run
- **AND** the file SHALL hold exactly its bytes from before the command, including the uncommitted edit, no loop SHALL be answered, and the exit code SHALL be `2`

#### Scenario: A warning alone fails the validation
- **GIVEN** an `Amendment` to `add-plan-export` with a MODIFIED requirement 534 characters long, which `openspec validate --all --strict` accepts and the trial fold's `openspec validate --specs --strict` reports as a `[WARNING]`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** the output SHALL contain `## validation: failed`, the `[WARNING]` line and `nothing resumed`, and the file SHALL be restored
- **AND** `openspec/` in the repository SHALL be otherwise unchanged, with the change not archived, and the exit code SHALL be `2`

#### Scenario: A failed amendment that created a file deletes it
- **GIVEN** an `Amendment` whose `delta` names a `spec.md` that does not exist, and whose `text` fails validation
- **WHEN** `build <change> --amend` runs
- **THEN** that file SHALL not exist afterwards, the change loop SHALL still be `blocked`, and the exit code SHALL be `2`
