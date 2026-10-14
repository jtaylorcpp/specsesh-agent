## MODIFIED Requirements

### Requirement: The change check runs once after the last group
With the queue empty, `check` SHALL run each of `changeChecks` in the workspace, in order, as an argv with no shell, recorded as one `Iteration` targeting `{ check: "change" }` with a `CheckEvidence` per command. All exiting `0` SHALL run the trial fold, and a passing fold SHALL end the loop `converged` with every group entered and `unclaimed` the delta scenarios no task quoted by exact name when the loop started; any other exit SHALL end it `failed`, running no fold.

#### Scenario: An unclaimed scenario is reported
- **GIVEN** a change whose scenario `An empty plan` no task quotes, groups that converge, and a passing trial fold
- **WHEN** the change loop runs
- **THEN** it SHALL end `converged` with `unclaimed` listing `An empty plan`

#### Scenario: A failing change check fails the change
- **GIVEN** every group converges, and the change check `pnpm docs:check` exits `1`
- **WHEN** the change loop runs
- **THEN** it SHALL end `failed` with an unmet iteration whose evidence holds `pnpm docs:check` and exit `1`
- **AND** the trial fold SHALL NOT have run

### Requirement: An answered escalation resumes the change as a new run
`answerChangeEscalation` SHALL accept an answer only for a change loop that ended `blocked`, and only when `by` equals the escalation's `to`. It SHALL start a new change run, carrying the entries. For a change blocked by a group, that run SHALL hand the answer to `answerGroupEscalation` for the blocked group, await that group's new run, and then go on with the queue.

#### Scenario: Answering a blocked group resumes the change
- **GIVEN** a change blocked by group `2`, escalated to `principal`
- **WHEN** the principal answers `"Use the v2 API"`
- **THEN** group `2`'s loop SHALL resume with that decision, and group `3` SHALL run after it converges

## ADDED Requirements

### Requirement: A failing trial fold blocks the built change
After every change check exits `0`, `check` SHALL call `trialFold` from `src/task/cmd-close.ts` and add a `CheckEvidence` with its `command`, its `exit` (none when it could not spawn) and `formatTrialFold`'s text as output. If not `ok`, the loop SHALL end `blocked` at `level` `"change"` to `principal`, asking `trial fold failed: openspec validate --specs --strict`, a newline, then that text. The fold SHALL add no phase; the version SHALL stay `1`.

#### Scenario: A folded requirement over 500 characters blocks the build
- **GIVEN** every group converges and every change check exits `0`
- **WHEN** the trial fold exits `1` with an `ERROR` for `spec/judge`
- **THEN** the change SHALL end `blocked` at level `"change"`, to `principal`, with a question starting `trial fold failed: openspec validate --specs --strict` followed by `formatTrialFold`'s text naming `spec/judge`
- **AND** the `check` iteration's evidence SHALL hold `openspec validate --specs --strict --json` with exit `1`

#### Scenario: A passing fold builds the change
- **GIVEN** every group converges, every change check exits `0`, and the trial fold exits `0`
- **WHEN** the change loop runs
- **THEN** it SHALL end `converged`, and the `check` iteration's evidence SHALL hold `openspec validate --specs --strict --json` with exit `0` after the change checks

#### Scenario: A fold that cannot run blocks the build
- **GIVEN** every change check exits `0`
- **WHEN** `openspec` cannot be spawned for the trial fold
- **THEN** the change SHALL end `blocked` at level `"change"`, to `principal`, and the fold's evidence SHALL hold no exit and the `failure` text as output

#### Scenario: Killed during the trial fold
- **GIVEN** a change loop whose process is killed while the trial fold runs
- **WHEN** the loop is resumed from the same database
- **THEN** it SHALL run `check` again, the change checks then the fold, and no group loop SHALL start

### Requirement: Answering a fold block re-runs the check phase
When the change was blocked by the trial fold, the new run `answerChangeEscalation` starts SHALL carry the entries and begin at `check`, running the change checks and then the trial fold. It SHALL start no group loop and hand the answer to no group.

#### Scenario: Answering after the deltas are fixed builds the change
- **GIVEN** a change with groups `1`, `2` and `3` entered, blocked by the trial fold, whose deltas were then shortened
- **WHEN** the principal answers `"deltas shortened"`
- **THEN** the new run SHALL run only the change checks and the fold, and SHALL end `converged` listing groups `1`, `2` and `3`

#### Scenario: Answering without a fix blocks again
- **GIVEN** a change blocked by the trial fold whose deltas were not changed
- **WHEN** the principal answers
- **THEN** the new run SHALL end `blocked` again with the same question