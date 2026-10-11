## MODIFIED Requirements

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

### Requirement: resume continues a stored loop without the change files
`resume <loop-id>` SHALL take the database from `--db`, else the config's `db`, wait for the stored loop and read no change file. A loop id that is not an integer or is not in the database MUST print `no loop <id> in <path>` and exit `2`.

#### Scenario: An unknown loop id is refused
- **WHEN** the CLI runs `resume 42 --db loops.sqlite` and the database has no loop 42
- **THEN** stderr SHALL contain `no loop 42 in loops.sqlite` and the exit code SHALL be `2`

### Requirement: answer submits an escalation answer and waits for the resumed loop
`answer <loop-id> --by principal|agent --decision <text>`, with the database from `--db`, else the config's `db`, SHALL call `answerEscalation` and then wait for the resumed loop. A missing or invalid `--by`, a missing `--decision`, or an answer the loop rejects (not blocked, or `--by` not the escalation's recipient) MUST print the reason and exit `2`.

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

## REMOVED Requirements

### Requirement: The CLI has exactly three commands and prints usage otherwise
**Reason**: The CLI gains a fourth command, `status`.
**Migration**: See "The CLI has four commands and prints usage otherwise".

### Requirement: run takes a change directory, a task id and a database
**Reason**: `run` now takes a change id or path, a task id or `--next`, and the database from the flag or the repo config.
**Migration**: See "run takes a change and a task, with the database from flag or config".

## ADDED Requirements

### Requirement: The CLI has four commands and prints usage otherwise
`agentscript-task` SHALL accept `run`, `resume`, `answer` or `status` as its first argument. Any other first argument, or none, MUST print usage to stderr and exit `2`. The usage MUST begin with `usage:` and give one line per command, as the scenario "No command prints usage" lists them.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-task run <change> <task-id>|--next [--db <path>] [options]`, `agentscript-task resume <loop-id> [--db <path>] [--json]`, `agentscript-task answer <loop-id> [--db <path>] --by principal|agent --decision <text> [--json]` and `agentscript-task status [--db <path>]`

#### Scenario: status is a command
- **WHEN** the CLI runs `status`
- **THEN** it SHALL NOT print usage

### Requirement: run takes a change and a task, with the database from flag or config
`run` SHALL take a change (an id or a path) and either a task id or `--next`. The database SHALL be `--db`, else the config's `db`. A missing change, neither a task id nor `--next`, both of them, or no database from either source MUST print usage and exit `2` before any database is opened.

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
