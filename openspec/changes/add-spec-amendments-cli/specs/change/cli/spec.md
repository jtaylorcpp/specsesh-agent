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

## ADDED Requirements

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
- **AND** the output SHALL contain, in order, `amended openspec/changes/add-plan-export/specs/plan/export/spec.md`, `## validation: passed`, `resumed task 2.2 with decision: amendment-applied` and `# add-plan-export — converged`
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
