## MODIFIED Requirements

### Requirement: run prints the loop id before any model call
Immediately after the loop task is created and before the harness resumes, `run` SHALL print to stderr exactly `loop <id> — resume with: specsesh task resume <id> --db <path>`.

#### Scenario: The resume hint is the first stderr line
- **WHEN** the CLI runs a loop
- **THEN** stderr SHALL match `^loop \d+ — resume with: specsesh task resume \d+ --db `

### Requirement: Text output reports each iteration and the outcome
Without `--json`, the CLI SHALL print `# loop <id> — <status>`, then per iteration `## iteration <n>: <met|unmet>` followed by its unmet summary when not met, then the escalation's `to` and `question` when blocked, or `ticked: <true|false>` when converged. A blocked outcome SHALL end with the exact resume command, `specsesh task answer <loop> --db <path> --by <to> --decision "…"`.

#### Scenario: A converged loop prints its iterations and ticked
- **WHEN** a loop converges on iteration 2 with tasks.md from the change directory
- **THEN** stdout SHALL contain `# loop`, `converged`, `## iteration 1: unmet`, `## iteration 2: met` and `ticked: true`

#### Scenario: A blocked loop ends with the answer command
- **GIVEN** loop `7` in `loops.sqlite` blocked with an escalation to `"principal"`
- **WHEN** the text outcome is printed
- **THEN** its last line SHALL be `specsesh task answer 7 --db loops.sqlite --by principal --decision "…"`

### Requirement: The CLI has five commands and prints usage otherwise
`agentscript-task`, and `specsesh task`, which runs it, SHALL accept `run`, `spec`, `resume`, `answer` or `status` as its first argument. Any other first argument, or none, MUST print usage to stderr and exit `2`. The usage MUST begin with `usage:` and give one `specsesh task` line per command, as the scenario "No command prints usage" lists them.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `specsesh task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]`, `specsesh task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]`, `specsesh task resume <loop-id>|--all [--db <path>] [--json]`, `specsesh task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]` and `specsesh task status [--db <path>]`

#### Scenario: status is a command
- **WHEN** the CLI runs `status`
- **THEN** it SHALL NOT print usage

### Requirement: Text output for a group lists its tasks and the group check
Without `--json`, a group loop SHALL print `# group loop <id> — <status>`, then per task `## task <id>: <status> (runs <n>)`, then `## group check: passed` or `## group check: failed` for its last round, then, when blocked, the escalation's `to` and `question` and the exact `specsesh task answer <loop> --db <path> --by <to> --decision "…"` command as its last line.

#### Scenario: A converged group prints its tasks
- **WHEN** a group loop converges with `1.1` run twice and `1.2` once
- **THEN** stdout SHALL contain `# group loop`, `converged`, `## task 1.1: converged (runs 2)`, `## task 1.2: converged (runs 1)` and `## group check: passed`

### Requirement: Text output for a spec loop ends with the next step
The text output SHALL start `# spec loop <id> — <status>`, then one line per draft: `## <stage> draft <n>: clean` or `: <k> issues`, each issue below it. A review SHALL end with the files' paths and the approve and revise commands for that loop. An approval SHALL end with the next stage's `spec` command or, when none remains, `specsesh task <change> --next-group`; an approved proposal with `slices.md` SHALL then list a `spec <id> --intent "<intent>"` command per later slice, in order.

#### Scenario: A review prints both commands
- **WHEN** loop `12` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `specsesh task answer 12 --by principal --decision approve` and `specsesh task answer 12 --by principal --decision "<what to change>"`

#### Scenario: The last approval points at execution
- **WHEN** the last stage in `SPEC_STAGES` of `add-plan-export` is approved
- **THEN** the output SHALL end with `specsesh task add-plan-export --next-group`

#### Scenario: Approving a sliced proposal lists the other slices
- **GIVEN** `slices.md` with `add-plan-export`, `add-plan-export-schema` and `add-plan-export-ci`
- **WHEN** the proposal is approved
- **THEN** the output SHALL list `specsesh task spec add-plan-export-schema --intent "…"` then `specsesh task spec add-plan-export-ci --intent "…"`, each with its slice's intent

### Requirement: resume --all prints one outcome line per root
`resume --all` SHALL print one stdout line per root: `loop <id> <change> <task|group <n>|spec <stage>>[ (via <ids>)] — <status>`, where `(via …)` names the nested interrupted loops the root carried on. `blocked` SHALL be followed by `: ` and the `answer` command, `refused` by `: ` and the reason. It SHALL exit `0` when every root converged or is a spec loop blocked for review, else `1`. With no interrupted loop it SHALL print `no interrupted loops in <db>` and exit `0`.

#### Scenario: A blocked root ends with the answer command
- **GIVEN** interrupted group loop `13` of `add-plan-export` group `1` holding interrupted task loop `14`, in `.agentscript/task-loops.sqlite`
- **WHEN** `resume --all` resumes it and it ends blocked to `principal`
- **THEN** stdout SHALL contain `loop 13 add-plan-export group 1 (via 14) — blocked: specsesh task answer 13 --db .agentscript/task-loops.sqlite --by principal --decision "…"` and the exit code SHALL be `1`

#### Scenario: Nothing to resume
- **GIVEN** `.agentscript/task-loops.sqlite` with no interrupted loop
- **WHEN** the CLI runs `resume --all`
- **THEN** stdout SHALL be `no interrupted loops in .agentscript/task-loops.sqlite` and the exit code SHALL be `0`

## ADDED Requirements

### Requirement: Task hints name specsesh task
Every command line the task CLI prints for a person to run SHALL begin `specsesh task`: the resume hints of `run`, `spec`, `resume` and `answer` (`loop <id> — resume with: specsesh task resume <id> --db <path>`), the answer commands of a blocked task, group or spec loop, and the spec loop's next-step lines. No usage, refusal, hint or next-step line SHALL contain `agentscript-task` or `pnpm task`.

#### Scenario: The spec resume hint names specsesh task
- **WHEN** `spec add-plan-export --intent "Export a plan"` starts a spec loop
- **THEN** stderr SHALL contain a line matching `^loop \d+ — resume with: specsesh task resume \d+ --db `

#### Scenario: A blocked group ends with the specsesh answer command
- **GIVEN** a group loop `9` that ends blocked, escalated to `principal`
- **WHEN** its text output is printed with database `loops.sqlite`
- **THEN** its last line SHALL be `specsesh task answer 9 --db loops.sqlite --by principal --decision "…"`

#### Scenario: The task usage names no old command
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL contain neither `agentscript-task` nor `pnpm task`
