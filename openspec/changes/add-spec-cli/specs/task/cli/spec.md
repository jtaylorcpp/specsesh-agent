## RENAMED Requirements

- FROM: `### Requirement: The CLI has four commands and prints usage otherwise`
- TO: `### Requirement: The CLI has five commands and prints usage otherwise`

## MODIFIED Requirements

### Requirement: The CLI has five commands and prints usage otherwise
`agentscript-task` SHALL accept `run`, `spec`, `resume`, `answer` or `status` as its first argument. Any other first argument, or none, MUST print usage to stderr and exit `2`. The usage MUST begin with `usage:` and give one line per command, as the scenario "No command prints usage" lists them.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]`, `agentscript-task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]`, `agentscript-task resume <loop-id> [--db <path>] [--json]`, `agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]` and `agentscript-task status [--db <path>]`

#### Scenario: status is a command
- **WHEN** the CLI runs `status`
- **THEN** it SHALL NOT print usage

### Requirement: The exit code says whether the loop converged
`run`, `spec`, `resume` and `answer` SHALL exit `0` when the loop's outcome status is `"converged"`, or when a spec loop ends `"blocked"` for review; and `1` when a task or group loop ends `"blocked"`, a spec loop ends `"blocked"` on a question, or any loop ends `"exhausted"` or `"failed"`. The harness SHALL be closed before exiting, also after a refusal.

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

## ADDED Requirements

### Requirement: spec runs one stage of a change
`spec <change> [<stage>]` SHALL run the named stage, or the first in `SPEC_STAGES` without an approval whose hashes match. A missing change needs `--intent` or `--intent-file`: the change directory is created and `intent.md` holds the words. An existing `intent.md` with `--intent` given, a missing change without one, an unknown stage, or `--worktree` SHALL be refused with exit `2`. It SHALL NOT check that the tree is clean.

#### Scenario: A new change starts at the proposal
- **WHEN** `spec add-plan-export --intent "Export a plan"` runs and the change does not exist
- **THEN** `openspec/changes/add-plan-export/intent.md` SHALL hold `Export a plan`, and the proposal stage SHALL run

#### Scenario: A new change without an intent is refused
- **WHEN** `spec add-plan-export` runs and the change does not exist
- **THEN** it SHALL exit `2` naming `--intent`, and create nothing

#### Scenario: A dirty tree does not refuse spec
- **GIVEN** an uncommitted edit outside the change
- **WHEN** `spec` runs
- **THEN** it SHALL run the stage

### Requirement: status and answer cover spec loops
`status` SHALL list a spec loop with `spec <stage>` where a task loop shows its task. `answer <loop-id>` on a spec loop SHALL call `answerSpecLoop` with `--by`, `--decision` and `--principal`, which defaults to `git config user.name`, then `$USER`.

#### Scenario: status shows the stage
- **WHEN** `status` runs after a proposal stage loop
- **THEN** its line SHALL show `spec proposal`

#### Scenario: answer approves with the git name
- **GIVEN** `git config user.name` is `jesse`
- **WHEN** `answer <id> --by principal --decision approve` runs on a proposal review
- **THEN** `approvals.json` SHALL record `principal` `jesse`

### Requirement: Text output for a spec loop ends with the next step
The text output SHALL start `# spec loop <id> — <status>`, then one line per draft: `## <stage> draft <n>: clean` or `: <k> issues`, each issue below it. A review SHALL end with the files' paths and the approve and revise commands for that loop. An approval SHALL end with the next stage's `spec` command or, when none remains, `pnpm task <change> --next-group`.

#### Scenario: A review prints both commands
- **WHEN** loop `12` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `pnpm task answer 12 --by principal --decision approve` and `pnpm task answer 12 --by principal --decision "<what to change>"`

#### Scenario: The last approval points at execution
- **WHEN** the last stage in `SPEC_STAGES` of `add-plan-export` is approved
- **THEN** the output SHALL end with `pnpm task add-plan-export --next-group`
