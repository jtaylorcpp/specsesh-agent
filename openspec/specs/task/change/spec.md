# task/change Specification

## Purpose
The change loop: build a whole OpenSpec change by running each task group in order as a child group loop, then a change check, returning the ontology's `LoopOutcome<ChangeOutcome>`.

## Requirements

### Requirement: The task entry exports the change loop
`./task` SHALL export `startChangeLoop(harness, options, context)`, returning `Promise<TaskId<LoopOutcome<ChangeOutcome>>>`, `waitForChangeLoop`, `answerChangeEscalation`, `changeLoopExtensions(options)` and `ChangeLoopOptions`: the group loop's options without `group`, plus `changeChecks?` (default the `checks`). `changeLoopExtensions` SHALL return the change loop's extension plus those `groupLoopExtensions` returns.

#### Scenario: A host starts and awaits a change loop
- **GIVEN** groups `1` and `2`, each with one task that converges, and passing checks
- **WHEN** a host calls `startChangeLoop` and then `waitForChangeLoop` with the returned id
- **THEN** it SHALL receive a converged `LoopOutcome<ChangeOutcome>` listing groups `1` and `2`, each with `runs` `1`

### Requirement: A change builds only when it is valid and as approved
`startChangeLoop` SHALL refuse, creating nothing, a change that fails strict validation, naming the first issue, and, when `approvals.json` exists, one with a stage unapproved or a file whose sha256 no longer matches, naming it. A change with no `approvals.json` SHALL NOT be refused for that. A scenario no task names SHALL NOT refuse the build.

#### Scenario: An invalid change refuses the build
- **WHEN** `startChangeLoop` is called for a change whose delta has a requirement with no scenario
- **THEN** it SHALL reject naming that requirement, and no loop SHALL exist

#### Scenario: An edited approved tasks.md refuses the build
- **GIVEN** a change whose four stages are approved, and `tasks.md` edited afterwards
- **WHEN** `startChangeLoop` is called
- **THEN** it SHALL reject naming `tasks.md` and the tasks stage

#### Scenario: A hand-written change builds
- **WHEN** `startChangeLoop` is called for a valid change with no `approvals.json`
- **THEN** a change loop SHALL start

### Requirement: The change loop is one durable task with three phases
The change loop SHALL be the pi-durable task `agentscript.change-loop`, version `1`, whose checkpoint is `{ phase, queue, entries, child? }` with `phase` one of `next`, `group` and `check`. The queue SHALL be every group in `tasks.md`, ascending, ticked or not. Each phase MUST end by committing the next checkpoint or a terminal outcome.

#### Scenario: A finished group is checked, not rebuilt
- **GIVEN** group `1` whose tasks are all ticked, and group `2` with an unticked task
- **WHEN** the change loop runs
- **THEN** group `1`'s loop SHALL start no task loop, and both groups SHALL be entered with `runs` `1`

#### Scenario: Killed during a group
- **GIVEN** a change loop whose process is killed while group `2`'s loop runs
- **WHEN** the loop is resumed from the same database
- **THEN** it SHALL continue that group loop, and no second loop SHALL start for group `2`

### Requirement: A group runs as a child group loop, and its block blocks the change
`group` SHALL start an `agentscript.group-loop` child with the change's options, record its id and await it, idempotently by that id. A converged child SHALL be entered and return to `next`. A blocked child SHALL end the change `blocked`, its escalation copied at `level` `"change"`. An exhausted or failed child SHALL end it `failed`, naming the group. Later groups MUST NOT run.

#### Scenario: A blocked group blocks the change
- **GIVEN** group `2`'s loop blocks with an escalation to `principal` asking `"Which API?"`
- **WHEN** the change loop records it
- **THEN** the change SHALL end `blocked` at level `"change"`, to `principal`, asking `"Which API?"`, and group `3` SHALL NOT have run

#### Scenario: A failed group ends the change
- **WHEN** group `1`'s loop ends `exhausted`
- **THEN** the change SHALL end `failed`, naming group `1`, and group `2` SHALL NOT have run

### Requirement: The change check runs once after the last group
With the queue empty, `check` SHALL run each of `changeChecks` in the workspace, in order, as an argv with no shell, recorded as one `Iteration` targeting `{ check: "change" }` with a `CheckEvidence` per command. All exiting `0` SHALL end the loop `converged` with every group entered and `unclaimed` the delta scenarios no task quoted by exact name when the loop started; any other exit SHALL end it `failed`.

#### Scenario: An unclaimed scenario is reported
- **GIVEN** a change whose scenario `An empty plan` no task quotes, and groups that converge
- **WHEN** the change loop runs
- **THEN** it SHALL end `converged` with `unclaimed` listing `An empty plan`

#### Scenario: A failing change check fails the change
- **GIVEN** every group converges, and the change check `pnpm docs:check` exits `1`
- **WHEN** the change loop runs
- **THEN** it SHALL end `failed` with an unmet iteration whose evidence holds `pnpm docs:check` and exit `1`

### Requirement: An answered escalation resumes the change as a new run
`answerChangeEscalation` SHALL accept an answer only for a change loop that ended `blocked`, and only when `by` equals the escalation's `to`. It SHALL start a new change run, carrying the entries, that hands the answer to `answerGroupEscalation` for the blocked group, awaits that group's new run, and then goes on with the queue.

#### Scenario: Answering a blocked group resumes the change
- **GIVEN** a change blocked by group `2`, escalated to `principal`
- **WHEN** the principal answers `"Use the v2 API"`
- **THEN** group `2`'s loop SHALL resume with that decision, and group `3` SHALL run after it converges
