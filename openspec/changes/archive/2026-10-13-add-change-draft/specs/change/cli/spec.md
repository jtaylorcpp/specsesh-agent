## Purpose
The change CLI: `agentscript-change`, run as `pnpm change`, whose commands are what happens to a change (draft, approve, build, close). Each is addressed by change id, finds the change's loop itself, and ends with the command to run next.

## ADDED Requirements

### Requirement: agentscript-change takes a command and a change
`agentscript-change` SHALL take a command and a change id under the config's `changesDir`. Any other command, or none, MUST print usage to stderr and exit `2`, one line per command as the scenario "No command prints usage" lists them. It SHALL resolve the database, provider and model as `agentscript-task` does, read no stdin, never prompt, and exit `2` on a refusal.

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]`

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate add-plan-export`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: draft starts or continues a change's draft
With no draft loop of the change waiting for an answer, `draft <change>` SHALL start a draft loop over `SPEC_STAGES` and print it. A missing change needs `--intent` or `--intent-file`; its directory is created with `intent.md` holding the words. Without either, `--intent` on an existing change, or feedback with nothing waiting SHALL exit `2`. With every stage approved, nothing SHALL start.

#### Scenario: A new change starts at the proposal
- **WHEN** `draft add-plan-export --intent "Export a plan"` runs and the change does not exist
- **THEN** `intent.md` SHALL hold `Export a plan`, and the draft's first spec loop SHALL be the proposal's

#### Scenario: A new change without an intent is refused
- **WHEN** `draft add-plan-export` runs and the change does not exist
- **THEN** it SHALL exit `2` naming `--intent`, and create nothing

#### Scenario: An edited design redrafts from the design
- **GIVEN** a change whose four stages are approved, and `design.md` edited afterwards
- **WHEN** `draft add-plan-export` runs
- **THEN** the draft's first spec loop SHALL be the design's

#### Scenario: A fully approved change starts nothing
- **GIVEN** a change whose four stages are approved and unchanged
- **WHEN** `draft add-plan-export` runs
- **THEN** no loop SHALL start, the output SHALL say every stage is approved, and the exit code SHALL be `0`

### Requirement: draft with feedback answers what is waiting
When the change's latest draft loop ended `blocked`, `draft <change> <feedback>` SHALL answer it with the feedback as the principal's decision, wait for the new run and print it. Without feedback it SHALL print what is waiting again, start nothing, and exit as that loop did.

#### Scenario: Feedback redrafts the stage under review
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`
- **WHEN** `draft add-plan-export "JSON only"` runs
- **THEN** the proposal's next draft SHALL carry `The principal asked for: JSON only`

#### Scenario: Feedback answers a stage's question
- **GIVEN** `add-plan-export` waiting on the question `CSV too?`
- **WHEN** `draft add-plan-export "No"` runs
- **THEN** the stage SHALL draft again carrying `The principal asked for: No`

#### Scenario: draft alone shows what is waiting
- **GIVEN** `add-plan-export` waiting for review of `design.md`
- **WHEN** `draft add-plan-export` runs
- **THEN** the output SHALL name `design.md`, no loop SHALL start, and the exit code SHALL be `0`

### Requirement: Draft output ends with the next command
The output SHALL start `# <change> — <state>`, then `## <stage>: approved` per approved stage, then the current stage's `### <stage> draft <n>` lines. A review SHALL end with its files, `pnpm change draft <change> "<what to change>"` and `pnpm task answer <id> --by principal --decision approve`; a question with it and `pnpm change draft <change> "<answer>"`, exiting `1`; a drafted change with `pnpm task <change> --next-group`.

#### Scenario: A review ends with both commands
- **WHEN** draft loop `12` of `add-plan-export` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `pnpm change draft add-plan-export "<what to change>"` and `pnpm task answer 12 --by principal --decision approve`

#### Scenario: A question exits 1
- **WHEN** a draft ends waiting on the question `CSV too?`
- **THEN** the output SHALL end with `CSV too?` and `pnpm change draft add-plan-export "<answer>"`, and the exit code SHALL be `1`

#### Scenario: A drafted change points at the next step
- **WHEN** a draft of `add-plan-export` ends `converged`
- **THEN** the output SHALL end with `pnpm task add-plan-export --next-group`
