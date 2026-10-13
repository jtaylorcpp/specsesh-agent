# spec/loop Specification

## Purpose
The spec loop: an agent drafts one stage of an OpenSpec change (its proposal, design, specs or tasks), rules with no model check the draft, and the loop iterates until the rules pass, then hands the draft to the principal for review.

## Requirements

### Requirement: A spec stage is a name, its files, a script and a gate
The task entry SHALL export `SpecStage` as `{ name, owns, script, after?, seed?, gate }`, plus `startSpecLoop`, `waitForSpecLoop`, `answerSpecLoop` and `specLoopExtensions`. `owns` lists paths relative to the change directory; one ending in `/` owns every file under it. `after` names the stages that must be approved first. `gate(context)` SHALL return `ValidationReport` issues for the stage's files, using no model.

#### Scenario: A stage owning a directory
- **GIVEN** a stage owning `design.md` and `design/`
- **WHEN** it is asked whether it owns `design.md`, `design/examples/a.ts` and `tasks.md`
- **THEN** it SHALL own the first two and not `tasks.md`

### Requirement: The stage script keeps the stage contract
A stage script SHALL declare the strings `change_id`, `stage`, `intent`, `approved`, `current`, `base`, `carried`, `files`, `summary`, `next_action` and `question`, and the number `iteration`. `startSpecLoop` SHALL refuse a script that breaks this, listing each problem, or whose `next_action` default is not `review` or `ask`, and start nothing.

#### Scenario: A script without files is refused
- **WHEN** a stage script that does not declare `files` is started
- **THEN** the start SHALL be refused naming `files`, and no task SHALL exist

#### Scenario: A next_action default outside the choices is refused
- **WHEN** a stage script whose `next_action` defaults to `"retry"` is started
- **THEN** the start SHALL be refused naming `review` and `ask`

### Requirement: The spec loop is one durable task with four phases
The package SHALL define the pi-durable task `agentscript.spec-loop`, version `1`, with phases `iterate`, `await`, `write` and `gate`. `iterate` SHALL start an `agentscript.run` child with the contract seeded, `current` read from disk, and `next_action` choices `review` and `ask`; `await` SHALL wait for that child by id; `write` SHALL write the bundle; `gate` SHALL run the stage's gate.

#### Scenario: A crash during await starts no second run
- **GIVEN** a spec loop checkpointed at `await` for iteration 1
- **WHEN** the process dies and the loop resumes
- **THEN** it SHALL wait for the same child run and start no other

#### Scenario: The current files are re-read each iteration
- **GIVEN** a draft the principal edited by hand after iteration 1
- **WHEN** iteration 2 starts
- **THEN** its `current` SHALL hold the edited text

### Requirement: Files come back as a bundle, written only where the stage owns
`files` SHALL be read as sections, each opened by a line `=== <path>` and running to the next such line; text before the first is ignored. A section whose path the stage owns SHALL be written to the change directory. An absolute path, a `..` segment or an unowned path SHALL NOT be written and SHALL become an `ERROR` issue; a bundle with no section SHALL be an `ERROR` issue too.

#### Scenario: Two files in one bundle
- **WHEN** a design stage returns sections for `design.md` and `design/mock.html`
- **THEN** both files SHALL be written with exactly their section text

#### Scenario: A file the stage does not own
- **WHEN** a proposal stage returns a section for `tasks.md`
- **THEN** `tasks.md` SHALL NOT be written, and the round SHALL have an `ERROR` issue naming it

#### Scenario: An empty bundle
- **WHEN** a stage returns `files` with no `=== ` line
- **THEN** the round SHALL have an `ERROR` issue saying the stage wrote no files

### Requirement: Gate issues carry into the next iteration within budget
A round with any `ERROR` or `WARNING` issue SHALL be recorded as an unmet `Iteration` targeting `{ check: "<stage> gate" }`, its issues carried into the next iteration one per line as `<level> <path>: <message>`. After `maxIterations` rounds (default 8) the loop SHALL end `exhausted`.

#### Scenario: An issue is fixed on the second iteration
- **GIVEN** a gate that reports one issue on the first draft and none on the second
- **WHEN** the loop runs
- **THEN** iteration 2's `carried` SHALL hold the issue, and the loop SHALL reach review after two iterations

#### Scenario: Issues every time exhaust the budget
- **GIVEN** a gate that always reports an issue and `maxIterations` 2
- **WHEN** the loop runs
- **THEN** it SHALL end `exhausted` after two iterations

### Requirement: A clean gate blocks for the principal's review
A round with no `ERROR` or `WARNING` issue SHALL end the loop `blocked` with result `{ change, stage, files, approved: false }` and an escalation `{ level: "change", to: "principal", reason: "review" }` naming the files, saying to answer approve or say what to change. `next_action` `ask` SHALL end it `blocked` with reason `question`, the script's question and `to` the loop's `escalateTo`, after writing and before the gate.

#### Scenario: A clean draft waits for review
- **WHEN** the gate reports no issues for `proposal.md`
- **THEN** the loop SHALL end `blocked` with reason `review`, and the question SHALL name `proposal.md`

#### Scenario: The stage asks a question
- **WHEN** the script sets `next_action` `ask` with a question
- **THEN** the loop SHALL end `blocked` with reason `question` and that question, and the gate SHALL NOT run

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
