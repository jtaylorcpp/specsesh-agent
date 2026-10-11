# durable/cli Specification

## Purpose
The agentscript-durable command: run a script durably on a Node SQLite database, and resume it from the same database after the process dies.

## Requirements

### Requirement: The CLI has exactly two commands and prints usage otherwise
`agentscript-durable` SHALL provide a CLI whose first argument is `run` or `resume`. Any other first argument, or none, MUST print the usage text to stderr and exit `2`. The usage text MUST begin with `usage:` and list:
- `agentscript-durable run <file> --db <path> [--provider <id>] [--model <id>] [--entry <subagent>]... [--var name=value]... [--json]`
- `agentscript-durable resume <task-id> --db <path> [--json]`

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: Both commands require a target and a database
After the command, the CLI SHALL parse the options `--db` (string), `--provider` (string), `--model` (string), `--entry` (string, repeatable), `--var` (string, repeatable) and `--json` (boolean, default false), with the first positional as the target (the script file for `run`, the task ID for `resume`). A missing target or a missing `--db` MUST print the usage text to stderr and exit `2` before any database is opened.

#### Scenario: run without --db prints usage
- **WHEN** the CLI runs `run x.agent`
- **THEN** the exit code SHALL be `2`

#### Scenario: resume without a task ID prints usage
- **WHEN** the CLI runs `resume --db runs.sqlite`
- **THEN** the exit code SHALL be `2`

### Requirement: The CLI opens a durable SQLite harness with both extensions
For both commands the CLI SHALL open `Harness.open(await openNodeSqliteStorage(<--db>), { models, registry }, BACKGROUND_CONTEXT)` with a registry that has `AgentScript` and `AgentScriptStepExtension` installed, and MUST close the harness in a `finally` block on every path after it was opened, including early exits and thrown errors. The SQLite file MUST be created if it does not exist.

#### Scenario: The harness is closed after a refusal
- **GIVEN** `run` with an unknown model
- **WHEN** the CLI exits `2`
- **THEN** the harness SHALL have been closed before `main` returns

### Requirement: The model collection defaults to every built-in provider plus claude-code
When no `models` dependency is injected, the CLI SHALL build its model collection from pi-ai's `builtinModels()` and then register the `claude-code` provider from `@specsesh/agent/claude-code` (`claudeCodeProvider()`), so `--provider claude-code` runs steps through the user's own `claude` binary. Credentials MUST be pi-ai's own environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...); the CLI reads no other credential.

#### Scenario: claude-code is a selectable provider
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider claude-code --model claude-haiku-4-5`
- **THEN** the model SHALL resolve and each step SHALL be sent to the `claude-code` provider

### Requirement: run resolves provider and model from flag, then environment, then defaults
`run` SHALL resolve the provider as `--provider`, else `AGENTSCRIPT_PROVIDER`, else `anthropic` (`DEFAULT_PROVIDER`), and the model as `--model`, else `AGENTSCRIPT_MODEL`, else `claude-haiku-4-5` (`DEFAULT_MODEL`). If `models.getModel(provider, model)` is undefined it MUST print `no model "<model>" on provider "<provider>"` to stderr and exit `2` before reading the script or creating a task.

#### Scenario: An unknown model is refused before a task exists
- **WHEN** the CLI runs `run pipeline.agent --db runs.sqlite --provider faux --model nope`
- **THEN** stderr SHALL contain `no model "nope" on provider "faux"`
- **AND** the exit code SHALL be `2`
- **AND** no task SHALL exist in the database

#### Scenario: Environment variables pick the model when flags are absent
- **GIVEN** `AGENTSCRIPT_PROVIDER=claude-code` and `AGENTSCRIPT_MODEL=haiku` and no `--provider`/`--model`
- **WHEN** the CLI runs `run`
- **THEN** the run SHALL use provider `claude-code` and model `haiku`

#### Scenario: Defaults apply when nothing is set
- **GIVEN** no flags and neither environment variable
- **WHEN** the CLI runs `run`
- **THEN** the run SHALL use provider `anthropic` and model `claude-haiku-4-5`

### Requirement: run starts the task with the script, entries, overrides and model
`run` SHALL read the script file as UTF-8 and call `startScript` with `model: { provider, modelId }`, `entry` set to the list of `--entry` values when at least one was given, and `variables` set to the `--var` values parsed by `parseVar` when at least one was given. Without `--entry` the step machine's default entry (the first subagent) MUST apply.

#### Scenario: Repeated --entry runs those subagents in order
- **WHEN** the CLI runs `run pipeline.agent --db runs.sqlite --entry classify --entry gate --entry respond`
- **THEN** the run SHALL dispatch `classify` and then `respond`, with `gate` run as logic in between

#### Scenario: --var overrides a starting value
- **WHEN** the CLI runs `run` with `--var report=slow --json`
- **THEN** the JSON output's `variables.report` SHALL be `"slow"`
- **AND** `steps[0].request.prompt` SHALL be `Classify: slow`

### Requirement: run prints the task ID before any model call
Immediately after the task is created and before `harness.resume()` is called, `run` SHALL print to stderr exactly `task <id> — resume with: agentscript-durable resume <id> --db <path>`, so a crash at any later point still leaves the user the ID to resume.

#### Scenario: The resume hint is the first stderr line
- **WHEN** the CLI runs a script to completion
- **THEN** stderr SHALL match `^task \d+ — resume with: agentscript-durable resume \d+ --db `

### Requirement: resume continues a stored task without the script file
`resume` SHALL convert its target with `Number(...)` and, when the result is not an integer or `harness.getTask` finds no such task, print `no task <target> in <db>` to stderr and exit `2`. Otherwise it MUST NOT read any file: the script is the task's stored input.

#### Scenario: A crashed run finishes on resume
- **GIVEN** a SQLite file holding a pipeline run whose process exited with code 137 during the `respond` request
- **WHEN** the CLI runs `resume <id> --db <file>` with only `respond`'s answer (`Escalated.`) available
- **THEN** the exit code SHALL be `0`
- **AND** stdout SHALL contain `# task <id> — completed`, `Escalated.` and `urgent = true`
- **AND** exactly one model request SHALL be made

#### Scenario: An unknown task ID is refused
- **WHEN** the CLI runs `resume 999 --db <empty file>`
- **THEN** stderr SHALL contain `no task 999` and the exit code SHALL be `2`

#### Scenario: A non-integer task ID is refused
- **WHEN** the CLI runs `resume abc --db runs.sqlite`
- **THEN** stderr SHALL contain `no task abc` and the exit code SHALL be `2`

### Requirement: Both commands resume the harness and wait for the run
After creating (run) or finding (resume) the task, the CLI SHALL call `harness.resume()` and then `waitForScript(harness, id, context)`. When `waitForScript` throws (the run ended aborted or errored, or the task is not terminal), the error MUST propagate out of `main`; the bin entry point prints `<name>: <message>` to stderr and exits `1`.

#### Scenario: An aborted run exits 1 with the reason
- **GIVEN** a task that ended aborted
- **WHEN** the CLI runs `resume <id>`
- **THEN** stderr SHALL contain `ended aborted` and the exit code SHALL be `1`

### Requirement: Text output reports each step and the final variables
Without `--json`, the CLI SHALL print to stdout:
1. `# task <id> — <kind>`;
2. for each step i (1-based): `## step <i>: <subagent> → <outcome kind>`, then for a failed step `<category>: <message>`; otherwise the step's text when it is non-empty; and for an answered step with a structured result `structured: <JSON>`;
3. `## variables`, then one `<name> = <JSON value>` line per variable in state order.

#### Scenario: A completed run's text output
- **GIVEN** the pipeline run answered `{ severity: "high" }` then `On it.`
- **WHEN** the CLI runs it without `--json`
- **THEN** stdout SHALL contain `— completed`, `On it.` and `urgent = true`

#### Scenario: A failed step prints its category and message
- **GIVEN** a step that settles `failed`
- **WHEN** the CLI prints the result
- **THEN** the line after that step's heading SHALL be `<category>: <message>`

### Requirement: JSON output is the task ID merged with the run result
With `--json`, the CLI SHALL print to stdout one two-space-indented JSON object `{ task: <id>, kind, steps, variables }`, the task ID followed by the `RunResult` fields, and nothing else on stdout.

#### Scenario: JSON is machine-readable
- **WHEN** the CLI runs `run` with `--json`
- **THEN** `JSON.parse(stdout)` SHALL succeed with `kind` equal to `"completed"`

### Requirement: The exit code says whether the run completed
The CLI SHALL exit `0` when the `RunResult.kind` is `"completed"` and `1` when it is `"failed"` or `"cut-short"`.

#### Scenario: A failed run exits 1
- **GIVEN** a model that answers the structured `classify` step with text only
- **WHEN** the CLI runs the pipeline
- **THEN** stdout SHALL contain `— failed` and the exit code SHALL be `1`

#### Scenario: A completed run exits 0
- **WHEN** a run completes
- **THEN** the exit code SHALL be `0`

### Requirement: parseVar types a name=value pair the way the dialect spells values
The durable CLI module, `src/bin/agentscript-durable.ts`, SHALL export `parseVar(raw)` (not a public entry point), splitting at the first `=`. A raw string with no `=`, or with `=` as its first character, MUST throw `--var expects name=value, got "<raw>"`. The value MUST become `true` for exactly `True`, `false` for exactly `False`, a number when it is non-empty and matches `^-?\d+(\.\d+)?$`, and the string as written otherwise. Everything after the first `=` belongs to the value.

#### Scenario: Values are typed
- **WHEN** `parseVar` is called with `a=b`, `n=2`, `t=True` and `f=False`
- **THEN** it SHALL return `["a", "b"]`, `["n", 2]`, `["t", true]` and `["f", false]`

#### Scenario: Lower-case booleans and empty values stay strings
- **WHEN** `parseVar` is called with `t=true` and `e=`
- **THEN** it SHALL return `["t", "true"]` and `["e", ""]`

#### Scenario: A value may contain =
- **WHEN** `parseVar("q=a=b")` is called
- **THEN** it SHALL return `["q", "a=b"]`

#### Scenario: A pair without a name is refused
- **WHEN** `parseVar` is called with `=x` or `novalue`
- **THEN** it SHALL throw an error containing `--var expects name=value`

### Requirement: main is callable in-process with injected dependencies
The CLI module SHALL export `main(argv, deps?): Promise<number>` returning the exit code, where `deps` is a `CliDeps` of optional `models` (a function returning a pi-ai `Models`, sync or async), `out` (one stdout line) and `err` (one stderr line). Absent deps MUST default to the built-in models and to writing lines to `process.stdout` and `process.stderr`. The module MUST run `main(process.argv.slice(2))` and exit with its code only when executed directly.

#### Scenario: Tests run the CLI against a faux provider
- **GIVEN** `deps.models` returning a collection with a faux provider, and capturing `out`/`err`
- **WHEN** a test awaits `main(["run", script, "--db", db, "--provider", <faux>, "--model", <faux id>], deps)`
- **THEN** it SHALL resolve to the exit code with output captured and no process exit
