## ADDED Requirements

### Requirement: The tasks stage plans from the approved deltas
The task entry SHALL export `tasksStage`, named `tasks`, owning `tasks.md`, after `specs`, with the bundled `spec-plan.agent`. Its seed SHALL set `approved` to the proposal, `design.md`, the files under `design/examples/` and every delta as `=== ` sections, and `base` to the workspace's `git ls-files`, cut at 3,000 lines with a line saying how many were cut.

#### Scenario: The tasks stage is seeded with the repository's files
- **GIVEN** a git workspace tracking 3,005 files
- **WHEN** the tasks stage's seed runs
- **THEN** `base` SHALL hold 3,000 paths and a last line saying 5 were cut

### Requirement: tasks.md is a list of unticked single-action tasks
The tasks gate SHALL report an `ERROR` for a line under a group heading that is neither a task nor its continuation, a task list failing the ontology's `TaskList` check, and a ticked task; and `taskIssues` for each task, its claims being the scenario names it quotes.

#### Scenario: A ticked task is sent back
- **WHEN** a draft holds `- [x] 1.1 …`
- **THEN** the gate SHALL report an `ERROR` naming task `1.1`

#### Scenario: A task naming two files is sent back
- **WHEN** a task names `src/a.ts` and `src/b.ts`
- **THEN** the gate SHALL report the `taskIssues` `WARNING` naming both

### Requirement: Every scenario of the change is named by a task
Each scenario of an ADDED or MODIFIED delta whose exact name no task quotes in double quotes SHALL be an `ERROR` naming the scenario and its capability.

#### Scenario: An unclaimed scenario is sent back
- **GIVEN** deltas with the scenario `A clean draft waits for review`
- **WHEN** no task quotes `"A clean draft waits for review"`
- **THEN** the gate SHALL report an `ERROR` naming that scenario

### Requirement: The tasks gate holds the change to the task budget
The gate SHALL include `sizeIssues` for the groups and tasks counted from `tasks.md`, and SHALL NOT report the capabilities, requirements or scenarios limits.

#### Scenario: Thirteen tasks are sent back
- **WHEN** `tasks.md` holds 13 tasks
- **THEN** the gate SHALL report the tasks `WARNING` naming `13` and `12`

### Requirement: The bundled plan script keeps the stage contract
`spec-plan.agent` SHALL lint with no error, keep the stage contract with `next_action` defaulting to `review`, and declare one subagent that sets `files`, `summary`, `next_action` and `question` from its outputs.

#### Scenario: The bundled plan script fits the contract
- **WHEN** the bundled `spec-plan.agent` is checked
- **THEN** it SHALL lint clean, pass the stage contract and declare exactly one subagent

## MODIFIED Requirements

### Requirement: The stages run in a fixed order
The task entry SHALL export `SPEC_STAGES` as `[proposalStage, designStage, specsStage, tasksStage]`, in that order; `spec` picks from it.

#### Scenario: The design follows the proposal
- **WHEN** the names in `SPEC_STAGES` are listed
- **THEN** they SHALL be `proposal`, `design`, `specs`, `tasks`
