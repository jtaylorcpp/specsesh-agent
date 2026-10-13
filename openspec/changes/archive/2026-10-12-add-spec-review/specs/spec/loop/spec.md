## MODIFIED Requirements

### Requirement: A spec stage is a name, its files, a script and a gate
The task entry SHALL export `SpecStage` as `{ name, owns, script, after?, seed?, gate }`, plus `startSpecLoop`, `waitForSpecLoop`, `answerSpecLoop` and `specLoopExtensions`. `owns` lists paths relative to the change directory; one ending in `/` owns every file under it. `after` names the stages that must be approved first. `gate(context)` SHALL return `ValidationReport` issues for the stage's files, using no model.

#### Scenario: A stage owning a directory
- **GIVEN** a stage owning `design.md` and `design/`
- **WHEN** it is asked whether it owns `design.md`, `design/examples/a.ts` and `tasks.md`
- **THEN** it SHALL own the first two and not `tasks.md`

## ADDED Requirements

### Requirement: An approve answer converges the stage and records it
`answerSpecLoop` with decision `approve` (trimmed, any case) on a review SHALL start a new run that writes no draft, records the approval in `approvals.json`, and ends `converged` with `approved: true`. The entry SHALL be the ontology's `Approval` plus `stage`, `at` and a sha256 per owned file. It SHALL replace that stage's earlier entry and drop every entry for a stage that names it in `after`, directly or through others.

#### Scenario: Approving the proposal
- **WHEN** the principal answers a proposal review with ` Approve `
- **THEN** the new run SHALL end `converged`, and `approvals.json` SHALL hold a proposal entry with the sha256 of `proposal.md`

#### Scenario: Re-approving the proposal drops the design's approval
- **GIVEN** approvals for the proposal and design stages
- **WHEN** a revised proposal is approved
- **THEN** `approvals.json` SHALL hold the new proposal entry and no design entry

### Requirement: Any other answer is carried into the next draft
Any decision other than `approve` on a review, and any decision on a question, SHALL start a new run whose first iteration carries `The principal asked for: <decision>`, numbering on from the blocked run's iterations, with `current` read from disk.

#### Scenario: A revision reaches the next draft
- **WHEN** the principal answers a review with `JSON only`
- **THEN** the next iteration's `carried` SHALL contain `The principal asked for: JSON only`

#### Scenario: An answered question is carried, even "approve"
- **WHEN** the principal answers a stage's question with `approve`
- **THEN** a new draft SHALL run with that answer carried, and nothing SHALL be recorded in `approvals.json`

### Requirement: Only the principal approves a stage
An answer to a review SHALL be refused unless `by` is `"principal"` and `principal` names who answered. A refused answer SHALL start no run and record nothing.

#### Scenario: An agent cannot approve a stage
- **WHEN** a review is answered `approve` with `by` `"agent"`
- **THEN** the answer SHALL be refused, and `approvals.json` SHALL be unchanged

### Requirement: A stage starts only after the stages it follows are approved and unchanged
`startSpecLoop` SHALL refuse a stage when a stage in its `after` has no entry in `approvals.json`, naming that stage, or when a recorded file's sha256 no longer matches it, naming the file and the stage. An `approvals.json` that fails its schema SHALL refuse the start, naming the file. A refused start creates nothing.

#### Scenario: Designing before the proposal is approved is refused
- **WHEN** a design stage is started for a change with no approvals
- **THEN** the start SHALL be refused naming the proposal stage

#### Scenario: An edited approved file is refused
- **GIVEN** an approved proposal whose `proposal.md` was edited afterwards
- **WHEN** a design stage is started
- **THEN** the start SHALL be refused naming `proposal.md` and the proposal stage

#### Scenario: A malformed approvals file refuses the start
- **WHEN** `approvals.json` holds an entry with `by` `"agent"`
- **THEN** the start SHALL be refused naming `approvals.json`
