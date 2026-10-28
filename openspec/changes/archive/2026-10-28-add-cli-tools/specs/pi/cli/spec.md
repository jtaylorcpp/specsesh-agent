## ADDED Requirements

### Requirement: run loads tools from --tools modules
`run` SHALL also take `--tools <path>` (repeatable) and `--workspace <dir>` (default the working directory), and the usage SHALL list both. Each module, resolved from the working directory, SHALL export as `default`, else `tools`, a `HostAction[]` or a function of `{ workspace }` returning one, sync or async. The modules' actions, in flag order, form one registry.

#### Scenario: A script calls a tool from a module
- **GIVEN** a module exporting `echo` (`{ text } → { text }`) and a script whose deterministic subagent runs `@actions.echo` and sets `@variables.out`
- **WHEN** the CLI runs `run <script> --tools <module>`
- **THEN** the exit code SHALL be `0` and `out` SHALL be the echoed text

#### Scenario: The model calls an offered tool from a module
- **GIVEN** a faux model that calls `echo`, then answers, and a script offering `echo` under `reasoning.actions`
- **WHEN** the CLI runs `run <script> --tools <module>`
- **THEN** `echo`'s `execute` SHALL run once and the run SHALL end `completed`

#### Scenario: A function export gets the workspace
- **GIVEN** a module whose `tools` export is a function, and `--workspace <dir>`
- **WHEN** the CLI runs
- **THEN** the function SHALL be called once with `{ workspace: <dir resolved> }`

### Requirement: A bad tools module or binding is refused before any model call
A module that fails to import, an entry that is not a valid executed `HostAction` (a `durable` one or a `delegate/` name included), or a duplicate name SHALL print `--tools <path>: <problem>` and exit `2`. A script whose actions don't bind to the loaded tools SHALL print the `ActionBindingError` message and exit `2`. Neither path SHALL make a model request.

#### Scenario: An entry without execute is refused
- **WHEN** the CLI runs with a module whose entry has no `execute`
- **THEN** stderr SHALL contain `--tools` and the module's path and `execute`, the exit code SHALL be `2`, and no model request SHALL be made

#### Scenario: A script naming a missing tool is refused
- **WHEN** a script targets `mcpTool://nowhere` and the module lacks it
- **THEN** stderr SHALL contain `not registered on this host`, and the exit code SHALL be `2` with no model request

#### Scenario: Without --tools nothing changes
- **WHEN** a script with no actions runs without `--tools`
- **THEN** it SHALL run exactly as before, with no tool host on the port
