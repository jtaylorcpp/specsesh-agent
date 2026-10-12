## RENAMED Requirements

- FROM: `### Requirement: The CLI has five commands and prints usage otherwise`
- TO: `### Requirement: The CLI has six commands and prints usage otherwise`

## MODIFIED Requirements

### Requirement: The CLI has six commands and prints usage otherwise
`agentscript-task` SHALL accept `run`, `spec`, `draft`, `resume`, `answer` or `status` as its first argument. Any other first argument, or none, MUST print usage to stderr and exit `2`. The usage MUST begin with `usage:` and give one line per command, as the scenario "No command prints usage" lists them.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]`, `agentscript-task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]`, `agentscript-task draft <change> [--intent <words>|--intent-file <path>] [--db <path>] [--json]`, `agentscript-task resume <loop-id> [--db <path>] [--json]`, `agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]` and `agentscript-task status [--db <path>]`

#### Scenario: status is a command
- **WHEN** the CLI runs `status`
- **THEN** it SHALL NOT print usage

### Requirement: The exit code says whether the loop converged
`run`, `spec`, `draft`, `resume` and `answer` SHALL exit `0` when the loop's outcome status is `"converged"`, or when a spec or draft loop ends `"blocked"` for review; and `1` when a task or group loop ends `"blocked"`, a spec or draft loop ends `"blocked"` on a question, or any loop ends `"exhausted"` or `"failed"`. The harness SHALL be closed before exiting, also after a refusal.

#### Scenario: A blocked loop exits 1
- **WHEN** a task loop ends `"blocked"`
- **THEN** the exit code SHALL be `1`

#### Scenario: A converged loop exits 0
- **WHEN** a loop ends `"converged"`
- **THEN** the exit code SHALL be `0`

#### Scenario: An exhausted group exits 1
- **WHEN** a group loop ends `"exhausted"`
- **THEN** the exit code SHALL be `1`

#### Scenario: A spec loop waiting for review exits 0
- **WHEN** a spec loop ends `"blocked"` with reason `review`
- **THEN** the exit code SHALL be `0`

#### Scenario: A draft loop waiting for review exits 0
- **WHEN** a draft loop ends `"blocked"` with reason `review`
- **THEN** the exit code SHALL be `0`

## ADDED Requirements

### Requirement: draft runs every stage of a change
`draft <change>` SHALL start a draft loop over `SPEC_STAGES` and wait for it. A missing change needs `--intent` or `--intent-file`, as for `spec`, and gets `intent.md`. A change with a spec or draft loop ended `blocked` and not yet answered SHALL be refused with exit `2`, naming that loop and its `answer` command. `draft` SHALL NOT check that the tree is clean, and SHALL refuse `--worktree`.

#### Scenario: A new change is drafted from its proposal
- **WHEN** `draft add-plan-export --intent "Export a plan"` runs and the change does not exist
- **THEN** `intent.md` SHALL hold `Export a plan`, and the draft's first spec loop SHALL be the proposal's

#### Scenario: A change awaiting review is refused
- **GIVEN** draft loop `12` of `add-plan-export`, blocked for review and not answered
- **WHEN** `draft add-plan-export` runs
- **THEN** it SHALL exit `2` naming loop `12` and `pnpm task answer 12`, and start nothing

### Requirement: status and answer cover draft loops
`status` SHALL list a draft loop as `draft <stage>`, the last stage it reached. `answer <loop-id>` on a draft loop SHALL call `answerDraftLoop` with `--by`, `--decision` and `--principal`, which defaults as for a spec loop, wait for the new run, and print it as `draft` does.

#### Scenario: status shows the draft's stage
- **WHEN** `status` runs after a draft loop blocked for review of the design
- **THEN** its line SHALL show `draft design`

#### Scenario: Approving through answer moves on
- **GIVEN** draft loop `12`, blocked for review of the proposal
- **WHEN** `answer 12 --by principal --decision approve` runs and the new run is `13`
- **THEN** the output SHALL start `# draft 13` and end with `pnpm task answer 13 --by principal --decision approve`

### Requirement: Text output for a draft loop ends with the next step
The output SHALL start `# draft <id> — <status>`, then `## <stage>: approved` per approved stage, then the current stage's drafts as `### <stage> draft <n>` lines. A review SHALL end with the files and the approve and revise commands for that draft loop. A converged draft SHALL end with `pnpm task <change> --next-group`. The run that approves a proposal with `slices.md` SHALL list `pnpm task draft <id> --intent "<intent>"` per later slice.

#### Scenario: A review prints both commands for the draft
- **WHEN** draft loop `12` ends waiting for review of `design.md`, after an approved proposal
- **THEN** the output SHALL contain `## proposal: approved` and end with `pnpm task answer 12 --by principal --decision approve` and `pnpm task answer 12 --by principal --decision "<what to change>"`

#### Scenario: A drafted change points at execution
- **WHEN** a draft loop of `add-plan-export` ends `converged`
- **THEN** the output SHALL end with `pnpm task add-plan-export --next-group`

#### Scenario: Approving a sliced proposal lists draft commands
- **GIVEN** `slices.md` with `add-plan-export`, `add-plan-export-schema` and `add-plan-export-ci`
- **WHEN** an answer approves the proposal through the draft
- **THEN** the output SHALL list `pnpm task draft add-plan-export-schema --intent "…"` then `pnpm task draft add-plan-export-ci --intent "…"`
