## MODIFIED Requirements

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

## ADDED Requirements

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
