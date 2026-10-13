## MODIFIED Requirements

### Requirement: agentscript-change takes a command and a change
`agentscript-change` SHALL take a command and a change id under the config's `changesDir`. Any other command, or none, MUST print usage to stderr and exit `2`, one line per command as the scenario "No command prints usage" lists them. It SHALL resolve the database, provider and model as `agentscript-task` does, read no stdin, never prompt, and exit `2` on a refusal.

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]`, `agentscript-change approve <change> [--principal <name>] [--db <path>]`, `agentscript-change build <change> [<answer>|--amend] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]` and `agentscript-change close <change> [--db <path>]`

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate add-plan-export`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: build with an answer continues a waiting build
When the change's latest change loop ended `blocked`, `build <change> <answer>` SHALL answer it as the escalation's `to` with the answer as the decision, wait for the new run and print it. An answer SHALL NOT write the escalation's `Amendment` and SHALL NOT run any validation. Without an answer it SHALL print the question again, start nothing, and exit `1`.

#### Scenario: Answering a waiting build continues it
- **GIVEN** `add-plan-export` blocked in group `2` of three, asking `Which API?`
- **WHEN** `build add-plan-export "Use the v2 API"` runs and the build converges
- **THEN** the output SHALL list groups `1`, `2` and `3` as converged

#### Scenario: build alone shows the question
- **GIVEN** `add-plan-export` blocked asking `Which API?`
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL contain `Which API?`, no loop SHALL start, and the exit code SHALL be `1`

#### Scenario: A text answer to an amendment writes nothing
- **GIVEN** `add-plan-export` blocked on an escalation whose `Amendment` has `delta` `specs/plan/export/spec.md`
- **WHEN** `build add-plan-export "Keep JSON, drop the sort"` runs
- **THEN** `openspec/changes/add-plan-export/specs/plan/export/spec.md` SHALL be unchanged, `openspec validate` SHALL NOT run, and the blocked loop SHALL be answered with the decision `Keep JSON, drop the sort`

## ADDED Requirements

### Requirement: build shows a proposed amendment as a diff
When the escalation a blocked change loop waits on carries `Amendment { delta, text }`, `build <change>` with no answer SHALL print, after the group lines, a `## proposed amendment` header naming the asking loop and `delta`, a unified diff from `openspec/changes/<change>/<delta>` on disk to `text`, then the question, `pnpm change build <change> --amend` and `pnpm change build <change> "<answer>"`, and exit `1`. Without an amendment the output SHALL be unchanged.

#### Scenario: A task loop's amendment is shown as a diff
- **GIVEN** `add-plan-export` blocked on task `2.2`'s escalation carrying an `Amendment` with `delta` `specs/plan/export/spec.md` whose `text` changes `- **THEN** stdout SHALL be the plan as JSON` to `- **THEN** stdout SHALL be the plan as JSON, with keys sorted`
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL contain `## proposed amendment (from task 2.2): specs/plan/export/spec.md`, `--- openspec/changes/add-plan-export/specs/plan/export/spec.md (on disk)`, `+++ openspec/changes/add-plan-export/specs/plan/export/spec.md (amended)`, the removed line prefixed `-` and the added line prefixed `+`
- **AND** the output SHALL end with the question, `pnpm change build add-plan-export --amend` and `pnpm change build add-plan-export "<answer>"`, no loop SHALL start, no file SHALL change, and the exit code SHALL be `1`

#### Scenario: A group judge's amendment names the judge
- **GIVEN** `add-csv-import` blocked on group `1`'s judge escalation carrying an `Amendment` with `delta` `specs/plan/import/spec.md`
- **WHEN** `build add-csv-import` runs
- **THEN** the output SHALL contain `## proposed amendment (from group 1 judge): specs/plan/import/spec.md`

#### Scenario: An escalation without an amendment shows no diff
- **GIVEN** `add-plan-export` blocked asking `Which API?` with no `Amendment`
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL contain no `## proposed amendment` line and no `pnpm change build add-plan-export --amend` line

### Requirement: build --amend refuses what it cannot apply
`build <change> --amend` SHALL exit `2`, writing and starting nothing, when the latest change loop is not `blocked` or its escalation has no `Amendment`, printing `<change> is not waiting on an amendment`; when an answer is also given, printing `--amend takes no answer: use either --amend or "<answer>"`; or when `delta`, after normalising, is absolute, has a `..` segment, or does not match `specs/**/spec.md`, printing `amendment delta "<delta>" is not specs/**/spec.md`.

#### Scenario: --amend with an answer is refused
- **GIVEN** `add-plan-export` blocked on an escalation carrying an `Amendment`
- **WHEN** `build add-plan-export --amend "Use v2"` runs
- **THEN** it SHALL print `--amend takes no answer: use either --amend or "<answer>"`, exit `2`, write no file, and start no loop

#### Scenario: --amend with no amendment waiting is refused
- **GIVEN** `add-other-thing` blocked on an escalation with no `Amendment`
- **WHEN** `build add-other-thing --amend` runs
- **THEN** it SHALL print `add-other-thing is not waiting on an amendment`, exit `2`, write no file, and start no loop

#### Scenario: A delta outside specs is refused
- **GIVEN** `add-bad-path` blocked on an escalation whose `Amendment` has `delta` `tasks.md`
- **WHEN** `build add-bad-path --amend` runs
- **THEN** it SHALL print `amendment delta "tasks.md" is not specs/**/spec.md`, exit `2`, leave `openspec/changes/add-bad-path/tasks.md` unchanged, and start no loop

### Requirement: build --amend writes, validates and resumes
When not refused, `--amend` SHALL save the bytes of `openspec/changes/<change>/<delta>`, or note it is absent, write `text` there, print `amended <path>`, and run `openspec validate --all --strict` with `OPENSPEC_TELEMETRY=0`. When that exits `0` reporting no error and no warning, it SHALL print `## openspec validate --all --strict: passed`, answer the blocked loop as a text answer would with the decision `amendment-applied`, and wait for and print the new run.

#### Scenario: A valid amendment resumes the task loop
- **GIVEN** `add-plan-export` blocked on task `2.2`'s escalation carrying an `Amendment` with `delta` `specs/plan/export/spec.md`, and validation that passes
- **WHEN** `build add-plan-export --amend` runs and the build converges
- **THEN** the delta file SHALL hold `text`, and the output SHALL contain `amended openspec/changes/add-plan-export/specs/plan/export/spec.md`, `## openspec validate --all --strict: passed` and `resumed task 2.2 with decision: amendment-applied`
- **AND** task `2.2` SHALL be answered through `answerEscalation` with `amendment-applied`, the output SHALL end with `pnpm change close add-plan-export`, and the exit code SHALL be `0`

#### Scenario: A valid amendment resumes the group judge
- **GIVEN** `add-csv-import` blocked on group `1`'s judge escalation carrying an `Amendment`, and validation that passes
- **WHEN** `build add-csv-import --amend` runs
- **THEN** group `1`'s judge SHALL be answered through `answerGroupEscalation` with `amendment-applied`, and the output SHALL contain `resumed group 1 judge with decision: amendment-applied`

### Requirement: A failed --amend restores the delta
When validation exits non-zero or its output reports any error or warning, `--amend` SHALL print `## openspec validate --all --strict: failed` and the validation output, write the saved bytes back to the delta file, or delete it if it did not exist before, print `restored <path>` and `nothing resumed`, and exit `2`. No loop SHALL be answered or started, and the change loop SHALL stay `blocked`.

#### Scenario: An error restores the exact bytes
- **GIVEN** `add-plan-export` blocked on an `Amendment` for `specs/plan/export/spec.md`, the delta file holding uncommitted edits, and validation that reports `[ERROR] requirement "Export writes JSON" is 534 characters (max 500)`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** the output SHALL contain `## openspec validate --all --strict: failed`, that `[ERROR]` line, `restored openspec/changes/add-plan-export/specs/plan/export/spec.md` and `nothing resumed`
- **AND** the delta file SHALL hold the same bytes as before the command, no loop SHALL start, the change loop SHALL stay `blocked`, and the exit code SHALL be `2`

#### Scenario: A warning alone fails the check
- **GIVEN** `add-plan-export` blocked on an `Amendment`, and validation that exits `0` but reports `[WARNING] requirement "Export writes JSON": scenario has no THEN`
- **WHEN** `build add-plan-export --amend` runs
- **THEN** the output SHALL contain `## openspec validate --all --strict: failed` and `nothing resumed`, the delta file SHALL be restored, and the exit code SHALL be `2`

#### Scenario: A file the amendment created is deleted
- **GIVEN** `add-plan-export` blocked on an `Amendment` whose `delta` `specs/plan/schema/spec.md` does not exist, and validation that fails
- **WHEN** `build add-plan-export --amend` runs
- **THEN** `openspec/changes/add-plan-export/specs/plan/schema/spec.md` SHALL NOT exist, and the exit code SHALL be `2`
