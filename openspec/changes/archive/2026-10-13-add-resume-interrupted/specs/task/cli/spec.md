## ADDED Requirements

### Requirement: resume --all resumes each interrupted loop once through its root
`resume --all` SHALL take `<db>.lock` once and resume every `interrupted` loop (`task/headless`) through its root. The root is the outermost still-running loop up its parent links (task → group → change), or the loop itself when its parent has ended. Roots SHALL resume once each, one after another, in stored start-time order with loop id as tie-break. Each resumes as `resume <loop-id>` would, worktree and stderr progress events included. A refused root SHALL NOT stop the batch.

#### Scenario: Nested loops resume through their parents in start order
- **GIVEN** interrupted task loop `10` inside interrupted group loop `11`, and interrupted task loop `14` inside interrupted group loop `13`, where group loop `13` started before group loop `11`
- **WHEN** the CLI runs `resume --all`
- **THEN** group loop `13` SHALL be resumed before group loop `11`, each exactly once
- **AND** loops `10` and `14` SHALL NOT be resumed on their own

#### Scenario: A refused root does not stop the batch
- **GIVEN** interrupted roots `11` and `13`, where `11` started first and `11`'s recorded worktree no longer exists
- **WHEN** the CLI runs `resume --all` and loop `13` converges
- **THEN** stdout's first line SHALL begin `loop 11 add-resume-hint group 2 (via 10) — refused: `, loop `13` SHALL still be resumed, and the exit code SHALL be `1`

### Requirement: resume --all prints one outcome line per root
`resume --all` SHALL print one stdout line per root: `loop <id> <change> <task|group <n>|spec <stage>>[ (via <ids>)] — <status>`, where `(via …)` names the nested interrupted loops the root carried on. `blocked` SHALL be followed by `: ` and the `answer` command, `refused` by `: ` and the reason. It SHALL exit `0` when every root converged or is a spec loop blocked for review, else `1`. With no interrupted loop it SHALL print `no interrupted loops in <db>` and exit `0`.

#### Scenario: A blocked root ends with the answer command
- **GIVEN** interrupted group loop `13` of `add-plan-export` group `1` holding interrupted task loop `14`, in `.agentscript/task-loops.sqlite`
- **WHEN** `resume --all` resumes it and it ends blocked to `principal`
- **THEN** stdout SHALL contain `loop 13 add-plan-export group 1 (via 14) — blocked: agentscript-task answer 13 --db .agentscript/task-loops.sqlite --by principal --decision "…"` and the exit code SHALL be `1`

#### Scenario: Nothing to resume
- **GIVEN** `.agentscript/task-loops.sqlite` with no interrupted loop
- **WHEN** the CLI runs `resume --all`
- **THEN** stdout SHALL be `no interrupted loops in .agentscript/task-loops.sqlite` and the exit code SHALL be `0`

### Requirement: resume --all refuses a loop id and --json
`resume` given both a loop id and `--all` MUST print usage and exit `2`. `resume --all --json` MUST print a message naming `--json`, then usage, and exit `2`. Both SHALL refuse before any loop resumes. `--json` applies to `resume <loop-id>` only, and keeps its current meaning there.

#### Scenario: A loop id with --all prints usage
- **WHEN** the CLI runs `resume 12 --all`
- **THEN** stderr SHALL begin with `usage:`, the exit code SHALL be `2`, and no loop SHALL be resumed

#### Scenario: --json with --all is refused
- **WHEN** the CLI runs `resume --all --json`
- **THEN** stderr SHALL contain `--json is not supported with --all` followed by usage, and the exit code SHALL be `2`

## MODIFIED Requirements

### Requirement: The CLI has five commands and prints usage otherwise
`agentscript-task` SHALL accept `run`, `spec`, `resume`, `answer` or `status` as its first argument. Any other first argument, or none, MUST print usage to stderr and exit `2`. The usage MUST begin with `usage:` and give one line per command, as the scenario "No command prints usage" lists them.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]`, `agentscript-task spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]`, `agentscript-task resume <loop-id>|--all [--db <path>] [--json]`, `agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--principal <name>] [--json]` and `agentscript-task status [--db <path>]`

#### Scenario: status is a command
- **WHEN** the CLI runs `status`
- **THEN** it SHALL NOT print usage

