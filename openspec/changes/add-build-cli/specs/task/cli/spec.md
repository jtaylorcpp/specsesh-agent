## RENAMED Requirements

- FROM: `### Requirement: The CLI has six commands and prints usage otherwise`
- TO: `### Requirement: The CLI has seven commands and prints usage otherwise`

## MODIFIED Requirements

### Requirement: The CLI has seven commands and prints usage otherwise
`agentscript-task` SHALL accept `run`, `spec`, `draft`, `build`, `resume`, `answer` or `status` as its first argument. Any other first argument, or none, MUST print usage to stderr and exit `2`. The usage MUST begin with `usage:` and give one line per command, as the scenario "No command prints usage" lists them.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]`, `agentscript-task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]`, `agentscript-task draft <change> [--intent <words>|--intent-file <path>] [--db <path>] [--json]`, `agentscript-task build <change> [--db <path>] [--change-check <command>]... [options]`, `agentscript-task resume <loop-id> [--db <path>] [--json]`, `agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]` and `agentscript-task status [--db <path>]`

#### Scenario: status is a command
- **WHEN** the CLI runs `status`
- **THEN** it SHALL NOT print usage

### Requirement: Text output for a draft loop ends with the next step
The output SHALL start `# draft <id> — <status>`, then `## <stage>: approved` per approved stage, then the current stage's drafts as `### <stage> draft <n>` lines. A review SHALL end with the files and the approve and revise commands for that draft loop. A converged draft SHALL end with `pnpm task build <change>`. The run that approves a proposal with `slices.md` SHALL list `pnpm task draft <id> --intent "<intent>"` per later slice.

#### Scenario: A review prints both commands for the draft
- **WHEN** draft loop `12` ends waiting for review of `design.md`, after an approved proposal
- **THEN** the output SHALL contain `## proposal: approved` and end with `pnpm task answer 12 --by principal --decision approve` and `pnpm task answer 12 --by principal --decision "<what to change>"`

#### Scenario: A drafted change points at execution
- **WHEN** a draft loop of `add-plan-export` ends `converged`
- **THEN** the output SHALL end with `pnpm task build add-plan-export`

#### Scenario: Approving a sliced proposal lists draft commands
- **GIVEN** `slices.md` with `add-plan-export`, `add-plan-export-schema` and `add-plan-export-ci`
- **WHEN** an answer approves the proposal through the draft
- **THEN** the output SHALL list `pnpm task draft add-plan-export-schema --intent "…"` then `pnpm task draft add-plan-export-ci --intent "…"`

## ADDED Requirements

### Requirement: build runs every group of a change
`build <change>` SHALL start a change loop and wait for it, mapping the flags a group run takes, plus `--change-check <command>` (repeatable), onto its options. A dirty tree without `--allow-dirty`, a refusal by the loop's guard, and `--worktree` SHALL each exit `2` and start nothing. `build` SHALL exit `0` when the change converges and `1` when it ends `blocked`, `exhausted` or `failed`.

#### Scenario: A build runs every group in order
- **GIVEN** a change with groups `1` and `2`, whose tasks converge on a faux model, and passing checks
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL list group `1` then group `2` as converged, and the exit code SHALL be `0`

#### Scenario: A dirty tree refuses build
- **GIVEN** an uncommitted edit in the repository
- **WHEN** `build add-plan-export` runs without `--allow-dirty`
- **THEN** it SHALL exit `2` naming `--allow-dirty`, and start nothing

#### Scenario: A refused guard exits 2
- **WHEN** `build add-plan-export` runs and a requirement of its deltas has no scenario
- **THEN** it SHALL exit `2` naming that requirement, and no loop SHALL exist

### Requirement: status and answer cover change loops
`status` SHALL list a change loop as `build <group>`, the last group it reached. `answer <loop-id>` on a change loop SHALL call `answerChangeEscalation` with `--by` and `--decision`, wait for the new run, and print it as `build` does.

#### Scenario: status shows the build's group
- **WHEN** `status` runs after a change loop blocked in group `2`
- **THEN** its line SHALL show `build 2`

#### Scenario: Answering a blocked build continues it
- **GIVEN** change loop `21`, blocked in group `2` of three, escalated to `principal`
- **WHEN** `answer 21 --by principal --decision "Use the v2 API"` runs and the build converges
- **THEN** the output SHALL list groups `1`, `2` and `3` as converged

### Requirement: Text output for a build lists each group
The output SHALL start `# build <id> — <status>`, then `## group <n>: <status> (<k> tasks, <r> reworks)` per group entered, then `## change check: passed` or the failing command and its output, then `## unclaimed: <n>` and each scenario when any. A blocked build SHALL end with the question and `pnpm task answer <id> --by <to> --decision "<your answer>"`; a converged build SHALL end with `pnpm spec:archive <change>`.

#### Scenario: A blocked build prints the answer command
- **WHEN** change loop `21` ends blocked, asking `principal` `"Which API?"`
- **THEN** the output SHALL contain `Which API?` and end with `pnpm task answer 21 --by principal --decision "<your answer>"`

#### Scenario: A built change points at archiving
- **WHEN** a change loop of `add-plan-export` ends `converged`
- **THEN** the output SHALL contain `## change check: passed` and end with `pnpm spec:archive add-plan-export`
