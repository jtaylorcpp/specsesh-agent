## MODIFIED Requirements

### Requirement: The change check runs once after the last group
With the queue empty, `check` SHALL run each of `changeChecks` in the workspace, in order, as an argv with no shell, recorded as one `Iteration` targeting `{ check: "change" }` with a `CheckEvidence` per command. Any non-zero exit SHALL end the loop `failed`, with no trial fold. All exiting `0` SHALL run the trial fold; a passing fold SHALL end the loop `converged` with every group entered and `unclaimed` the delta scenarios no task quoted by exact name when the loop started.

#### Scenario: An unclaimed scenario is reported
- **GIVEN** a change whose scenario `An empty plan` no task quotes, groups that converge, and a trial fold that passes
- **WHEN** the change loop runs
- **THEN** it SHALL end `converged` with `unclaimed` listing `An empty plan`

#### Scenario: A failing change check fails the change
- **GIVEN** every group converges, and the change check `pnpm docs:check` exits `1`
- **WHEN** the change loop runs
- **THEN** it SHALL end `failed` with an unmet iteration whose evidence holds `pnpm docs:check` and exit `1`, and the trial fold SHALL NOT have run

### Requirement: An answered escalation resumes the change as a new run
`answerChangeEscalation` SHALL accept an answer only for a change loop that ended `blocked`, and only when `by` equals the escalation's `to`. It SHALL start a new change run, carrying the entries. For a blocked group it SHALL hand the answer to `answerGroupEscalation`, await that group's new run, then go on with the queue. For a failing trial fold it SHALL go straight to `check`, re-running the change checks and the fold, without re-checking approvals.

#### Scenario: Answering a blocked group resumes the change
- **GIVEN** a change blocked by group `2`, escalated to `principal`
- **WHEN** the principal answers `"Use the v2 API"`
- **THEN** group `2`'s loop SHALL resume with that decision, and group `3` SHALL run after it converges

#### Scenario: Answering a fold block re-runs only the check
- **GIVEN** a change blocked by the trial fold with groups `1` and `2` entered, and deltas since fixed so the fold passes
- **WHEN** the principal answers `"specs shortened and re-approved"`
- **THEN** no group loop SHALL start, the change checks and the trial fold SHALL run once more, and the change SHALL end `converged` with groups `1` and `2`

## ADDED Requirements

### Requirement: A failing trial fold blocks the change
The trial fold SHALL run in `check` and be recorded as one more `CheckEvidence` in the same iteration, with command `openspec validate --specs --strict (trial fold)`, exit `0` when it passes and `1` otherwise, and the fold's output. A failing fold SHALL make the iteration unmet and end the loop `blocked`, escalated at `level` `"change"` to `principal` with a question holding the fold's output. The checkpoint shape and task version SHALL NOT change.

#### Scenario: A passing fold converges the change
- **GIVEN** groups `1` and `2` converge, every change check exits `0`, and the trial fold passes
- **WHEN** the change loop runs
- **THEN** it SHALL end `converged`, and the iteration's last evidence SHALL hold `openspec validate --specs --strict (trial fold)` and exit `0`

#### Scenario: Folded specs that fail block the build
- **GIVEN** every group converges and every change check exits `0`, and the folded `spec/judge` has a requirement over 500 characters
- **WHEN** the change loop runs
- **THEN** it SHALL end `blocked`, not `failed`, with an unmet iteration whose evidence holds `openspec validate --specs --strict (trial fold)` and exit `1`, escalated at level `"change"` to `principal` with a question holding the fold's output
