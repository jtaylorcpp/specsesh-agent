## ADDED Requirements

### Requirement: The trial fold returns structured issues
`src/task/cmd-close.ts` SHALL export `trialFold(workspace, change)`, which folds the change into a temporary copy of `openspec/`, runs `openspec validate --specs --strict --json` there and always removes the copy. It SHALL return `ok`, that `command`, `exit` (`null` if unspawnable), one `{ level, spec, message }` per `ERROR` or `WARNING` issue of each `type: "spec"` item, `spec` its id, and `failure` when it cannot run or prints no parseable JSON.

#### Scenario: INFO issues are dropped
- **GIVEN** a JSON report with item `task/change` of type `spec` holding one `ERROR` and one `INFO` issue
- **WHEN** `trialFold` returns
- **THEN** `issues` SHALL be exactly one `{ level: "ERROR", spec: "task/change" }` with that issue's message, and `ok` SHALL be `false`

#### Scenario: A fold with no parseable JSON
- **WHEN** the validate command prints no parseable JSON
- **THEN** `trialFold` SHALL return `ok` `false`, empty `issues` and a `failure` saying `no parseable JSON`, and the temporary copy SHALL no longer exist

#### Scenario: openspec cannot be spawned
- **WHEN** `openspec` cannot be spawned
- **THEN** `trialFold` SHALL return `ok` `false`, `exit` `null` and a `failure` holding the spawn error

### Requirement: A failing trial fold blocks the change
When every change check exits `0`, `check` SHALL call `trialFold` and add a `CheckEvidence` with its `command`, `exit` and `formatTrialFold` output, the text `close` prints. A fold with `ok` `false`, one that cannot run included, SHALL end the loop `blocked` at `level` `"change"`, to `principal`, asking `trial fold failed: openspec validate --specs --strict`, a newline, then that text. The checkpoint version SHALL stay `1`.

#### Scenario: A folded requirement over 500 characters blocks the build
- **GIVEN** every group converges and every change check exits `0`
- **WHEN** the trial fold reports an `ERROR` for `spec/judge` and exits `1`
- **THEN** the change SHALL end `blocked` at level `"change"`, to `principal`, its question starting `trial fold failed: openspec validate --specs --strict` and holding `formatTrialFold`'s lines, with evidence for `openspec validate --specs --strict --json` and exit `1`

#### Scenario: A fold that cannot run blocks the build
- **GIVEN** every change check exits `0`
- **WHEN** `openspec` cannot be spawned for the trial fold
- **THEN** the change SHALL end `blocked`, not `failed`, with fold evidence holding exit code `127` (`SPAWN_FAILED_EXIT_CODE`) and the `failure` text as its output

#### Scenario: Killed during the trial fold
- **GIVEN** a change loop whose process is killed while the trial fold runs
- **WHEN** the loop is resumed from the same database
- **THEN** it SHALL run `check` again, the change checks then the trial fold, and no group loop SHALL start

### Requirement: Answering a trial fold block re-runs the check phase
`answerChangeEscalation` SHALL accept an answer to a trial fold block under the same conditions as a group block, and SHALL start a new change run, carrying the entries, that goes straight to `check`: the change checks, then the trial fold. It SHALL start no group loop and SHALL NOT call `answerGroupEscalation`.

#### Scenario: Answering after fixing the deltas builds the change
- **GIVEN** a change of groups `1`, `2` and `3` blocked by the trial fold, whose deltas the principal has since shortened
- **WHEN** the principal answers `"deltas shortened"`
- **THEN** the new run SHALL run only the change checks and the trial fold, and end `converged` with groups `1`, `2` and `3` entered

#### Scenario: Answering without a fix blocks again
- **GIVEN** a change blocked by the trial fold whose deltas are unchanged
- **WHEN** the principal answers
- **THEN** the new run SHALL end `blocked` again with the same question

## MODIFIED Requirements

### Requirement: The change check runs once after the last group
With the queue empty, `check` SHALL run each of `changeChecks` in the workspace, in order, as an argv with no shell, recorded as one `Iteration` targeting `{ check: "change" }` with a `CheckEvidence` per command. Any non-zero exit SHALL end the loop `failed`. All exiting `0` and a passing trial fold SHALL end it `converged` with every group entered and `unclaimed` the delta scenarios no task quoted by exact name when the loop started.

#### Scenario: An unclaimed scenario is reported
- **GIVEN** a change whose scenario `An empty plan` no task quotes, groups that converge, and a trial fold that passes
- **WHEN** the change loop runs
- **THEN** it SHALL end `converged` with `unclaimed` listing `An empty plan`

#### Scenario: A failing change check fails the change
- **GIVEN** every group converges, and the change check `pnpm docs:check` exits `1`
- **WHEN** the change loop runs
- **THEN** it SHALL end `failed` with an unmet iteration whose evidence holds `pnpm docs:check` and exit `1`, and the trial fold SHALL NOT have run
