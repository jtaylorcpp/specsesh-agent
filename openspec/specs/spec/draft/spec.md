# spec/draft Specification

## Purpose
The draft loop: drafts a whole OpenSpec change by running each unapproved stage in order as a child spec loop, passing every review and question up to the principal, until every stage is approved.

## Requirements

### Requirement: The task entry exports the draft loop
`./task` SHALL export `startDraftLoop(harness, options, context)`, `waitForDraftLoop`, `answerDraftLoop`, `draftLoopExtensions(options)` and the types `DraftLoopOptions` and `DraftOutcome`. `DraftLoopOptions` SHALL be the spec loop's options with `stages` (default `SPEC_STAGES`) in place of one stage. `draftLoopExtensions` SHALL return the draft loop's extension plus those `specLoopExtensions` returns.

#### Scenario: A host starts and awaits a draft loop
- **GIVEN** a harness with the extensions `draftLoopExtensions` returns installed, and a faux model whose first draft is clean
- **WHEN** it calls `startDraftLoop` for `add-plan-export` and then `waitForDraftLoop` with the returned id
- **THEN** it SHALL receive an outcome `blocked` with reason `review`, naming `proposal.md`

### Requirement: The draft loop is one durable task with three phases
The draft loop SHALL be the pi-durable task `agentscript.draft-loop`, version `1`, whose checkpoint is `{ phase, stage?, child?, entries }` with `phase` one of `next`, `stage` and `answer`. Each phase MUST end by committing the next checkpoint or a terminal outcome.

#### Scenario: Killed while a stage drafts
- **GIVEN** a draft loop whose process is killed while the proposal's spec loop runs
- **WHEN** the loop is resumed from the same database
- **THEN** it SHALL continue that spec loop, and no second spec loop SHALL start for the proposal

### Requirement: The next phase picks the first stage without a current approval
`next` SHALL move to `stage` with the first of `stages` that has no entry in `approvals.json` whose hashes match its files, or end the loop `converged` when every stage has one. It MUST make no model request and start no child.

#### Scenario: A fully approved change converges at once
- **GIVEN** a change whose four stages are approved and unchanged
- **WHEN** a draft loop runs for it
- **THEN** it SHALL end `converged`, and no spec loop SHALL start

#### Scenario: An edited approved file reopens its stage
- **GIVEN** a change whose four stages are approved, and `design.md` edited afterwards
- **WHEN** a draft loop runs for it
- **THEN** its first spec loop SHALL be for the design stage

### Requirement: A stage runs as a child spec loop, and its block blocks the draft
`stage` SHALL start an `agentscript.spec-loop` child for the stage, record its id and await it, idempotently by that id. A converged child SHALL be entered and return to `next`. A blocked child SHALL end the draft `blocked` with the child's escalation unchanged. An exhausted or failed child SHALL end it `failed`, naming the stage.

#### Scenario: A review blocks the draft
- **WHEN** the proposal's spec loop ends blocked for review
- **THEN** the draft SHALL end `blocked` with reason `review` and the child's question, naming `proposal.md`

#### Scenario: An exhausted stage fails the draft
- **WHEN** the design's spec loop ends `exhausted`
- **THEN** the draft SHALL end `failed`, naming the design stage

### Requirement: An answer resumes the draft through its stage
`answerDraftLoop` SHALL accept an answer only for a draft loop that ended `blocked`. It SHALL start a new draft run at `answer`, which hands the answer to `answerSpecLoop` for the blocked child and awaits the run that starts, then goes on as `stage` does. When `answerSpecLoop` refuses, the answer SHALL be refused and no run SHALL start.

#### Scenario: Approving the proposal drafts the design
- **GIVEN** a draft blocked for review of the proposal
- **WHEN** the principal answers `approve`
- **THEN** the proposal SHALL be approved, a spec loop for the design SHALL start, and the new run SHALL end blocked for review of the design

#### Scenario: A revision redrafts the same stage
- **GIVEN** a draft blocked for review of the proposal
- **WHEN** the principal answers `JSON only`
- **THEN** the proposal's next draft SHALL carry `The principal asked for: JSON only`

#### Scenario: An agent cannot approve through the draft
- **WHEN** a draft blocked for review is answered `approve` with `by` `"agent"`
- **THEN** the answer SHALL be refused, no run SHALL start, and `approvals.json` SHALL be unchanged

### Requirement: The outcome is a LoopOutcome of DraftOutcome
The draft loop's outcome SHALL be a `LoopOutcome<DraftOutcome>` whose result is `{ change, stages }`, one entry per stage reached, in `stages` order, each `{ stage, approved, runs }`. `runs` SHALL count the spec loops this draft and the runs answering it started for the stage, `0` when it was approved before the draft began.

#### Scenario: An already approved proposal is entered with runs 0
- **GIVEN** a change whose proposal is approved
- **WHEN** a draft loop runs and blocks for review of the design
- **THEN** its result SHALL list the proposal with `approved` `true` and `runs` `0`, and the design with `runs` `1`
