# task/cli Specification

## Purpose
The `agentscript-task` command: run the task loop for one task of an OpenSpec change durably on a Node SQLite database, resume it after the process dies, and answer its escalation.

## Requirements

### Requirement: run maps its flags onto the task loop options
`run` SHALL pass `{ change: { dir }, task, script, workspace, budget, checks, allow, escalateTo, model, delegateModel, delegateContext }`, each from its flag, else the repo config (see `task/headless`), else its default: `--script <name|path>` (bundled `task`), `--workspace <dir>` (the current directory), repeatable `--check <command>` and `--allow <word>`, `--max-iterations <n>` (`budget.maxIterations`), `--escalate-to principal|agent`.

#### Scenario: Repeated checks are kept in order
- **WHEN** the CLI runs with `--check "pnpm test" --check "pnpm check"`
- **THEN** the loop's `checks` SHALL be `["pnpm test", "pnpm check"]`

#### Scenario: The workspace defaults to the current directory
- **WHEN** `run` is given no `--workspace`
- **THEN** the loop's `workspace` SHALL be the process's current directory

#### Scenario: A flag overrides the config
- **GIVEN** a repo config with `"checks": ["pnpm test"]`
- **WHEN** `run` is given `--check "pnpm check"`
- **THEN** the loop's `checks` SHALL be `["pnpm check"]`

### Requirement: run rejects malformed flag values with usage
`--max-iterations` whose value is not a positive integer, and `--escalate-to` whose value is not `principal` or `agent`, MUST print a message naming the flag and its value, followed by usage, and exit `2` before any database is opened.

#### Scenario: A zero budget is refused
- **WHEN** the CLI runs `run <dir> 2.4 --db loops.sqlite --max-iterations 0`
- **THEN** stderr SHALL name `--max-iterations` and `0`, and the exit code SHALL be `2`

### Requirement: run resolves provider and model like agentscript-durable
The provider SHALL be `--provider`, else `AGENTSCRIPT_PROVIDER`, else the config's `provider`, else `anthropic`; the model SHALL be `--model`, else `AGENTSCRIPT_MODEL`, else the config's `model`, else `claude-haiku-4-5`. The model collection SHALL be pi-ai's built-in providers plus the `claude-code` provider. An unknown model MUST print `no model "<model>" on provider "<provider>"` and exit `2` before a task exists.

#### Scenario: Defaults apply when nothing is set
- **GIVEN** no `--provider`, `--model`, `AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL` or repo config
- **WHEN** `run` starts a loop
- **THEN** every step SHALL use `anthropic/claude-haiku-4-5`

#### Scenario: An unknown model is refused before a task exists
- **WHEN** the CLI runs with `--model claude-nope`
- **THEN** stderr SHALL contain `no model "claude-nope"`, the exit code SHALL be `2`, and no task SHALL exist in the database

#### Scenario: The config supplies the provider
- **GIVEN** a repo config with `"provider": "claude-code"` and no provider flag or environment variable
- **WHEN** `run` starts a loop
- **THEN** every step SHALL use the `claude-code` provider

### Requirement: A refused start exits 2
When `startTaskLoop` or `startGroupLoop` rejects (an unreadable source, a missing artifact, an unknown task id or group, a group with no checks, a contract violation or an actions binding failure), `run` SHALL print the rejection's message to stderr and exit `2`.

#### Scenario: An unknown task id exits 2 listing the ids
- **WHEN** the CLI runs `run openspec/changes/archive/2026-10-11-baseline-agentscript-durable 9.9 --db loops.sqlite`
- **THEN** stderr SHALL contain `9.9` and `2.4`, and the exit code SHALL be `2`

#### Scenario: An unknown group exits 2 listing the groups
- **WHEN** the CLI runs `run fixture-live-task 9 --db loops.sqlite` and `tasks.md` has only group `1`
- **THEN** stderr SHALL contain `9` and `1`, and the exit code SHALL be `2`

### Requirement: run prints the loop id before any model call
Immediately after the loop task is created and before the harness resumes, `run` SHALL print to stderr exactly `loop <id> — resume with: agentscript-task resume <id> --db <path>`.

#### Scenario: The resume hint is the first stderr line
- **WHEN** the CLI runs a loop
- **THEN** stderr SHALL match `^loop \d+ — resume with: agentscript-task resume \d+ --db `

### Requirement: resume continues a stored loop without the change files
`resume <loop-id>` SHALL take the database from `--db`, else the config's `db`, wait for the stored task loop or group loop and read no change file. A loop id that is not an integer or is not in the database MUST print `no loop <id> in <path>` and exit `2`.

#### Scenario: An unknown loop id is refused
- **WHEN** the CLI runs `resume 42 --db loops.sqlite` and the database has no loop 42
- **THEN** stderr SHALL contain `no loop 42 in loops.sqlite` and the exit code SHALL be `2`

#### Scenario: A group loop is resumed
- **GIVEN** a group loop whose process died during task `1.2`
- **WHEN** the CLI runs `resume <id> --db loops.sqlite`
- **THEN** the group loop SHALL continue and print the group's outcome

### Requirement: answer submits an escalation answer and waits for the resumed loop
`answer <loop-id> --by principal|agent --decision <text>`, with the database from `--db`, else the config's `db`, SHALL call `answerEscalation` for a task loop, or `answerGroupEscalation` for a group loop, and then wait for the resumed loop. A missing or invalid `--by`, a missing `--decision`, or an answer the loop rejects (not blocked, or `--by` not the escalation's recipient) MUST print the reason and exit `2`.

#### Scenario: The wrong recipient exits 2
- **GIVEN** a blocked loop escalated to `principal`
- **WHEN** the CLI runs `answer <id> --db loops.sqlite --by agent --decision "go"`
- **THEN** the exit code SHALL be `2` and the loop SHALL stay blocked

### Requirement: Text output reports each iteration and the outcome
Without `--json`, the CLI SHALL print `# loop <id> — <status>`, then per iteration `## iteration <n>: <met|unmet>` followed by its unmet summary when not met, then the escalation's `to` and `question` when blocked, or `ticked: <true|false>` when converged. A blocked outcome SHALL end with the exact resume command, `agentscript-task answer <loop> --db <path> --by <to> --decision "…"`.

#### Scenario: A converged loop prints its iterations and ticked
- **WHEN** a loop converges on iteration 2 with tasks.md from the change directory
- **THEN** stdout SHALL contain `# loop`, `converged`, `## iteration 1: unmet`, `## iteration 2: met` and `ticked: true`

#### Scenario: A blocked loop ends with the answer command
- **GIVEN** loop `7` in `loops.sqlite` blocked with an escalation to `"principal"`
- **WHEN** the text outcome is printed
- **THEN** its last line SHALL be `agentscript-task answer 7 --db loops.sqlite --by principal --decision "…"`

### Requirement: JSON output is the loop id merged with the outcome
With `--json`, the CLI SHALL print `JSON.stringify({ loop: id, ...outcome }, null, 2)` to stdout, where `outcome` is the `LoopOutcome<TaskOutcome>` of a task loop or the `LoopOutcome<GroupOutcome>` of a group loop.

#### Scenario: JSON carries status and iterations
- **WHEN** the CLI runs with `--json`
- **THEN** stdout SHALL parse as JSON with an integer `loop`, a `status` and an `iterations` array

#### Scenario: JSON for a group carries its tasks
- **WHEN** the CLI runs a group with `--json`
- **THEN** stdout SHALL parse as JSON with an integer `loop`, a `status` and a `result.tasks` array with one entry per task

### Requirement: The CLI has four commands and prints usage otherwise
`agentscript-task` SHALL accept `run`, `resume`, `answer` or `status` as its first argument. Any other first argument, or none, MUST print usage to stderr and exit `2`. The usage MUST begin with `usage:` and give one line per command, as the scenario "No command prints usage" lists them.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [options]`, `agentscript-task resume <loop-id> [--db <path>] [--json]`, `agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--json]` and `agentscript-task status [--db <path>]`

#### Scenario: status is a command
- **WHEN** the CLI runs `status`
- **THEN** it SHALL NOT print usage

### Requirement: run takes a change and a task or a group, with the database from flag or config
`run` SHALL take a change (an id or a path) and exactly one of a task id (`<n>.<m>`), a group (a bare positive integer), `--next` or `--next-group`. The database SHALL be `--db`, else the config's `db`. A missing change, none or more than one of those, or no database from either source MUST print usage and exit `2` before any database is opened.

#### Scenario: No database from flag or config prints usage
- **GIVEN** no repo config
- **WHEN** the CLI runs `run fixture-live-task 1.1` without `--db`
- **THEN** the exit code SHALL be `2`

#### Scenario: run without a task id prints usage
- **WHEN** the CLI runs `run openspec/changes/archive/2026-10-11-baseline-agentscript-durable --db loops.sqlite`
- **THEN** the exit code SHALL be `2`

#### Scenario: A task id and --next together print usage
- **WHEN** the CLI runs `run fixture-live-task 1.1 --next --db loops.sqlite`
- **THEN** the exit code SHALL be `2`

#### Scenario: The config supplies the database
- **GIVEN** a repo config with `"db": ".agentscript/task-loops.sqlite"`
- **WHEN** the CLI runs `run fixture-live-task 1.1` without `--db`
- **THEN** the loop SHALL be stored in `.agentscript/task-loops.sqlite` under the config's directory

#### Scenario: A bare integer runs a group
- **WHEN** the CLI runs `run fixture-live-task 1 --db loops.sqlite`
- **THEN** it SHALL start a group loop for group `1`, not a task loop

#### Scenario: --next and --next-group together print usage
- **WHEN** the CLI runs `run fixture-live-task --next --next-group --db loops.sqlite`
- **THEN** the exit code SHALL be `2`

### Requirement: The exit code says whether the loop converged
`run`, `resume` and `answer` SHALL exit `0` when the task or group loop's outcome status is `"converged"` and `1` when it is `"blocked"`, `"exhausted"` or `"failed"`. The harness SHALL be closed before exiting, also after a refusal.

#### Scenario: A blocked loop exits 1
- **WHEN** a loop ends `"blocked"`
- **THEN** the exit code SHALL be `1`

#### Scenario: A converged loop exits 0
- **WHEN** a loop ends `"converged"`
- **THEN** the exit code SHALL be `0`

#### Scenario: An exhausted group exits 1
- **WHEN** a group loop ends `"exhausted"`
- **THEN** the exit code SHALL be `1`

### Requirement: run maps the group flags onto the group loop options
For a group, `run` SHALL pass the task-loop options plus `groupScript` from `--group-script <name|path>` (else the config's `groupScript`, else the bundled `group`) and `budget.maxReworks` from `--max-reworks <n>` (else the config's `maxReworks`, else `2`). A `--max-reworks` that is not a positive integer MUST print a message naming it and its value, then usage, and exit `2`.

#### Scenario: A rework budget from the flag
- **WHEN** the CLI runs `run fixture-live-task 1 --db loops.sqlite --max-reworks 1`
- **THEN** the group loop's `budget.maxReworks` SHALL be `1`

#### Scenario: A zero rework budget is refused
- **WHEN** the CLI runs `run fixture-live-task 1 --db loops.sqlite --max-reworks 0`
- **THEN** stderr SHALL name `--max-reworks` and `0`, and the exit code SHALL be `2`

### Requirement: --next-group picks the first group with an unticked task
With `--next-group`, `run` SHALL select the first `## <n>.` group of `tasks.md`, in file order, holding a `- [ ]` task. A change with none SHALL print `no unticked task in <change>` to stdout and exit `0` without creating a loop.

#### Scenario: --next-group skips a finished group
- **GIVEN** a `tasks.md` whose group `1` is all ticked and group `2` is not
- **WHEN** the CLI runs `run <change> --next-group`
- **THEN** it SHALL start a group loop for group `2`

### Requirement: Text output for a group lists its tasks and the group check
Without `--json`, a group loop SHALL print `# group loop <id> — <status>`, then per task `## task <id>: <status> (runs <n>)`, then `## group check: passed` or `## group check: failed` for its last round, then, when blocked, the escalation's `to` and `question` and the exact `agentscript-task answer <loop> --db <path> --by <to> --decision "…"` command as its last line.

#### Scenario: A converged group prints its tasks
- **WHEN** a group loop converges with `1.1` run twice and `1.2` once
- **THEN** stdout SHALL contain `# group loop`, `converged`, `## task 1.1: converged (runs 2)`, `## task 1.2: converged (runs 1)` and `## group check: passed`
