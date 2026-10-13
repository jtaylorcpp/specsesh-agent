# change/cli Specification

## Purpose
The change CLI: `agentscript-change`, run as `pnpm change`, whose commands are what happens to a change (draft, approve, build, close). Each is addressed by change id, finds the change's loop itself, and ends with the command to run next.

## Requirements

### Requirement: agentscript-change takes a command and a change
`agentscript-change` SHALL take a command and a change id under the config's `changesDir`. Any other command, or none, MUST print usage to stderr and exit `2`, one line per command as the scenario "No command prints usage" lists them. It SHALL resolve the database, provider and model as `agentscript-task` does, read no stdin, never prompt, and exit `2` on a refusal.

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]` and `agentscript-change approve <change> [--principal <name>] [--db <path>]`

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
When the change's latest draft loop ended `blocked`, `draft <change> <feedback>` SHALL answer it with the feedback as the principal's decision, wait for the new run and print it. Feedback that is `approve`, trimmed and in any case, SHALL exit `2` naming `pnpm change approve <change>`. Without feedback it SHALL print what is waiting again, start nothing, and exit as that loop did.

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

#### Scenario: approve is not feedback
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`
- **WHEN** `draft add-plan-export " Approve "` runs
- **THEN** it SHALL exit `2` naming `pnpm change approve add-plan-export`, and `approvals.json` SHALL be unchanged

### Requirement: Draft output ends with the next command
The output SHALL start `# <change> — <state>`, then `## <stage>: approved` per approved stage, then the current stage's `### <stage> draft <n>` lines. A review SHALL end with its files, `pnpm change draft <change> "<what to change>"` and `pnpm change approve <change>`; a question with it and `pnpm change draft <change> "<answer>"`, exiting `1`; a drafted change with `pnpm task <change> --next-group`.

#### Scenario: A review ends with both commands
- **WHEN** a draft of `add-plan-export` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `pnpm change draft add-plan-export "<what to change>"` and `pnpm change approve add-plan-export`

#### Scenario: A question exits 1
- **WHEN** a draft ends waiting on the question `CSV too?`
- **THEN** the output SHALL end with `CSV too?` and `pnpm change draft add-plan-export "<answer>"`, and the exit code SHALL be `1`

#### Scenario: A drafted change points at the next step
- **WHEN** a draft of `add-plan-export` ends `converged`
- **THEN** the output SHALL end with `pnpm task add-plan-export --next-group`

### Requirement: approve approves the stage under review
`approve <change>` SHALL answer the change's draft loop waiting for review with `approve`, by `principal`, recording `--principal` (default `git config user.name`, then `$USER`), wait for the new run and print it as `draft` does. A change waiting on a question SHALL exit `2` naming `pnpm change draft <change> "<answer>"`; one with nothing under review SHALL exit `2`. The run that approves a proposal with `slices.md` SHALL list `pnpm change draft <id> --intent "<intent>"` per later slice.

#### Scenario: Approving the proposal drafts the design
- **GIVEN** `add-plan-export` waiting for review of `proposal.md`, and `git config user.name` `jesse`
- **WHEN** `approve add-plan-export` runs
- **THEN** `approvals.json` SHALL record the proposal by `jesse`, and the output SHALL end waiting for review of the design

#### Scenario: A question cannot be approved
- **GIVEN** `add-plan-export` waiting on a question
- **WHEN** `approve add-plan-export` runs
- **THEN** it SHALL exit `2` naming `pnpm change draft add-plan-export "<answer>"`, and nothing SHALL start

#### Scenario: Nothing to approve is refused
- **GIVEN** `add-plan-export` with no draft loop waiting
- **WHEN** `approve add-plan-export` runs
- **THEN** it SHALL exit `2` saying nothing is under review

#### Scenario: Approving a sliced proposal lists draft commands
- **GIVEN** `slices.md` with `add-plan-export`, `add-plan-export-schema` and `add-plan-export-ci`
- **WHEN** `approve add-plan-export` approves the proposal
- **THEN** the output SHALL list `pnpm change draft add-plan-export-schema --intent "…"` then `pnpm change draft add-plan-export-ci --intent "…"`
