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
For both commands the CLI SHALL open `Harness.open(await openNodeSqliteStorage(<--db>), { models, registry }, BACKGROUND_CONTEXT)`. Its registry SHALL have `AgentScript` and `AgentScriptStepExtension` installed, or, when `--tools` is given, `agentScriptExtensions({ actions, workspace })`'s `run` and `step` with the loaded tools. It MUST close the harness in a `finally` block on every path after opening. The SQLite file MUST be created if absent.

#### Scenario: The harness is closed after a refusal
- **GIVEN** `run` with an unknown model
- **WHEN** the CLI exits `2`
- **THEN** the harness SHALL have been closed before `main` returns

#### Scenario: A durable run calls a tool from a module
- **GIVEN** a module exporting `echo` and a script that runs `@actions.echo`
- **WHEN** the CLI runs `run <script> --db <file> --tools <module>`
- **THEN** the exit code SHALL be `0` and the echoed value SHALL be among the variables

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

### Requirement: ollama is registered when the run needs it
When the model a command needs is on `ollama` (the resolved model for `run`, the stored task's model for `resume`), the CLI SHALL call `registerOllama` on its collection, injected or not, before checking the model, so the run and its resume use the pulled model. Otherwise it MUST NOT contact the Ollama server.

#### Scenario: A durable run completes on a pulled ollama model
- **GIVEN** `OLLAMA_HOST` pointing at a fake Ollama server listing `qwen3:8b` that answers each step
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider ollama --model qwen3:8b`
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and every chat request SHALL have reached the fake server

#### Scenario: Other providers never contact Ollama
- **GIVEN** `OLLAMA_HOST` pointing at a fake Ollama server
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider anthropic --model claude-nope`
- **THEN** the exit code SHALL be `2` and the fake server SHALL have received no request

#### Scenario: A crashed ollama run finishes on resume
- **GIVEN** a SQLite file holding a run on `ollama/qwen3:8b` whose process exited with code 137 during its second step, and a fake Ollama server listing `qwen3:8b`
- **WHEN** the CLI runs `resume <id> --db <file>` with `OLLAMA_HOST` pointing at that server
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and the fake server SHALL have received no request for the first step

### Requirement: An unreachable ollama is named in the refusal
When the provider is `ollama` and `registerOllama` reported the server unreachable, the `no model "<model>" on provider "ollama"` refusal SHALL end with ` (Ollama at <url>: <reason>)`, still exiting `2` before a task exists.

#### Scenario: An unreachable ollama is named in the refusal
- **GIVEN** `OLLAMA_HOST` pointing at a port nothing listens on
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider ollama --model qwen3:8b`
- **THEN** stderr SHALL contain `no model "qwen3:8b" on provider "ollama" (Ollama at ` followed by that URL
- **AND** the exit code SHALL be `2` and no task SHALL exist in the database

### Requirement: run and resume take --tools and --workspace
Both commands SHALL also take `--tools <path>` (repeatable) and `--workspace <dir>` (default the working directory), loaded and refused as `agentscript-pi run` does, before the harness opens. The usage SHALL list both on both lines, and `run`'s resume hint SHALL repeat the `--tools` and `--workspace` flags it was given.

#### Scenario: The resume hint repeats the tools
- **WHEN** `run <script> --db <file> --tools ./t.mjs` creates task 7
- **THEN** stderr SHALL contain `agentscript-durable resume 7 --db <file> --tools ./t.mjs`

#### Scenario: A bad tools module is refused before the database opens
- **WHEN** `run` is given a module that fails to import
- **THEN** stderr SHALL name `--tools` and the module, the exit code SHALL be `2`, and no task SHALL exist

### Requirement: resume re-checks the stored script against its tools
Before resuming, `resume` SHALL check the stored task's script against the loaded tools with `checkBindings`. A mismatch, including a resume with no `--tools` for a script that defines actions, SHALL print the `ActionBindingError` message and exit `2`, and the task MUST NOT resume.

#### Scenario: A crashed tool run resumes with its tools
- **GIVEN** a run with `--tools` killed mid-step
- **WHEN** `resume <id> --db <file> --tools <module>` runs
- **THEN** the run SHALL complete with exit `0`

#### Scenario: A resume without the tools is refused
- **GIVEN** a stored task whose script runs `@actions.echo`
- **WHEN** `resume <id> --db <file>` runs without `--tools`
- **THEN** stderr SHALL contain `not registered on this host`, the exit code SHALL be `2`, and no model request SHALL be made

### Requirement: run and resume take --mcp
Both commands SHALL also take `--mcp <file>` (repeatable), loaded and refused as `agentscript-pi run` does, before the harness opens. Its actions join the `--tools` actions in the registry installed with `agentScriptExtensions`. The usage SHALL list it on both lines, `run`'s resume hint SHALL repeat it, and every connection SHALL be closed after the harness closes.

#### Scenario: A durable run calls an MCP tool
- **GIVEN** an `--mcp` file naming the fixture server `fx` and a script that runs `mcpTool://fx/echo`
- **WHEN** the CLI runs `run <script> --db <file> --mcp <mcp>`
- **THEN** the exit code SHALL be `0`, and stderr's resume hint SHALL contain `--mcp <mcp>`

#### Scenario: A resume without the MCP file is refused
- **GIVEN** a stored task whose script runs `mcpTool://fx/echo`
- **WHEN** `resume <id> --db <file>` runs without `--mcp`
- **THEN** stderr SHALL contain `not registered on this host` and the exit code SHALL be `2`

### Requirement: claude-code durable runs offer tools through the bridge
The bins' model collection SHALL register `claudeCodeProvider({ bridge: mcpBridge() })`, so `run` and `resume` on provider `claude-code` with `--tools` or `--mcp` offer a step's tools to Claude Code. Each call SHALL run in the harness as a host action, recorded in the step's actions like any other provider's. The usage SHALL NOT say such a step fails.

#### Scenario: A durable claude-code run calls a --tools tool
- **GIVEN** a fake `claude` on `PATH` that reads its `--mcp-config` file, calls the first allowed tool over MCP with fixed arguments, and answers with the tool's text as `result`
- **WHEN** the CLI runs `run <script offering echo> --db <db> --provider claude-code --tools <echo module>`
- **THEN** the exit code SHALL be `0`, and the step's recorded actions SHALL hold one `echo` call with those arguments

#### Scenario: The usage no longer refuses claude-code tools
- **WHEN** the durable CLI prints its usage
- **THEN** it SHALL NOT contain `a step that offers tools fails`

#### Scenario: A claude-code run killed during a tool call resumes
- **GIVEN** a fake `claude` that calls the first allowed tool, or answers `resumed: <text>` when its prompt already holds the tool's result, and a tools module whose `echo` exits the process with `137` when `CRASH_ON_ECHO=1`
- **WHEN** `run --provider claude-code --tools <module>` with `CRASH_ON_ECHO=1` exits `137`, and `resume <id> --db <db> --tools <module>` follows without it
- **THEN** the resume SHALL exit `0`, `completed`, its last `claude` prompt SHALL contain `[called echo with`, and the step's text SHALL start with `resumed:`

### Requirement: google is registered and its key checked when the run needs it
When the model a command needs is on `google` (the resolved model for `run`, the stored task's model for `resume`), the CLI SHALL call `registerGemini` on its collection, injected or not, before checking the model. When it reports no key, the CLI MUST print `google: GEMINI_API_KEY is not set` and exit `2`, before a task exists or a resume starts.

#### Scenario: A durable run completes on Gemini
- **GIVEN** `GEMINI_API_KEY=test` and `GEMINI_BASE_URL` pointing at a fake Gemini server that answers each step
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider google --model gemini-3.5-flash`
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and every request SHALL have reached the fake server

#### Scenario: A durable run on google without a key creates no task
- **GIVEN** no `GEMINI_API_KEY`
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider google --model gemini-3.5-flash`
- **THEN** stderr SHALL contain `google: GEMINI_API_KEY is not set`, the exit code SHALL be `2`, and no task SHALL exist in the database

#### Scenario: A crashed Gemini run finishes on resume
- **GIVEN** a SQLite file holding a run on `google/gemini-3.5-flash` whose process exited with code 137 during its second step, and a fake Gemini server
- **WHEN** the CLI runs `resume <id> --db <file>` with `GEMINI_API_KEY=test` and `GEMINI_BASE_URL` pointing at that server
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and the fake server SHALL have received no request for the first step
