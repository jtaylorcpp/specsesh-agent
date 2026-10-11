## MODIFIED Requirements

### Requirement: The task config has a fixed set of typed fields
The `task` object SHALL accept only these fields, all optional: strings `changesDir`, `db`, `provider`, `model`, `delegateModel`, `script`, `groupScript` and `worktreeDir`; string arrays `checks`, `allow`, `delegateContext` and `worktreeSetup`; positive integers `maxIterations` and `maxReworks`; booleans `requireCleanTree` and `worktree`; and `escalateTo`, `"principal"` or `"agent"`.

#### Scenario: An empty task object is valid
- **GIVEN** `{ "task": {} }`
- **WHEN** the config is read
- **THEN** it SHALL be accepted and every value SHALL fall back to its default

### Requirement: Values resolve flag, then environment, then config, then default
Each value SHALL resolve separately: its flag when given, else its environment variable where one exists (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`), else the config field, else the default: provider `anthropic`, model `claude-haiku-4-5`, `delegateModel` the resolved model, script `task`, `groupScript` `group`, `maxIterations` `3`, `maxReworks` `2`, `escalateTo` `"principal"`, `requireCleanTree` `true`, `changesDir` `openspec/changes`.

#### Scenario: The environment beats the config
- **GIVEN** a config with `"model": "claude-haiku-4-5"` and `AGENTSCRIPT_MODEL=sonnet`
- **WHEN** `run` starts without `--model`
- **THEN** the model SHALL be `sonnet`

#### Scenario: Unset fields fall through independently
- **GIVEN** a config with only `"checks": ["pnpm test"]`
- **WHEN** `run` starts with `--max-iterations 5`
- **THEN** `checks` SHALL come from the config and `maxIterations` SHALL be `5`

### Requirement: status lists the loops in the database
`agentscript-task status` SHALL print one line per loop in the database, task loops and group loops alike: its id, change, task (or `group <n>`), status (`running`, `converged`, `blocked`, `exhausted` or `failed`) and iteration count, newest first. With no loops it SHALL print `no loops in <db>` and exit `0`.

#### Scenario: Two loops are listed newest first
- **GIVEN** loop `1` converged and loop `2` blocked
- **WHEN** `status` runs
- **THEN** the first line SHALL describe loop `2` as `blocked` and the second loop `1` as `converged`

#### Scenario: An empty database
- **WHEN** `status` runs on a database with no loops
- **THEN** stdout SHALL be `no loops in <db>` and the exit code SHALL be `0`

#### Scenario: A group loop and its task loops are listed
- **GIVEN** a group loop for group `1` that ran task loops for `1.1` and `1.2`
- **WHEN** `status` runs
- **THEN** it SHALL list the group loop as `group 1` and each task loop with its task id

## REMOVED Requirements

### Requirement: The stream has six event kinds
**Reason**: The stream now also carries group events; the name would be false.
**Migration**: See "A task loop streams six event kinds" and "A group loop streams four more event kinds".

## ADDED Requirements

### Requirement: A task loop streams six event kinds
A task loop's events SHALL be:
- `loop-started` with `change`, `task`, `script`, `at`;
- `iteration-started` with `iteration`, `at`;
- `action` with `iteration`, `kind`, `summary`, `refs`;
- `evidence` with `iteration`, `kind` and the evidence's own fields;
- `verdict` with `iteration`, `met`, `unmet`, `next`;
- `loop-ended` with `status`, `iterations`, `ticked`, `changed`.

`at` is ISO-8601. A `warning` event with `message` MAY appear.

#### Scenario: A converged loop's stream
- **WHEN** a loop converges on iteration 1
- **THEN** the events SHALL include, in order, `loop-started`, `iteration-started` with `iteration` `1`, at least one `verdict` with `met` `true`, and `loop-ended` with `status` `"converged"`

#### Scenario: A check becomes an evidence event
- **WHEN** an iteration's `run_checks` runs `pnpm test` and it exits `1`
- **THEN** the stream SHALL hold an `evidence` event with `kind` `"check"`, `command` `"pnpm test"` and `exitCode` `1`

### Requirement: A group loop streams four more event kinds
A group loop SHALL add `group-started` with `change`, `group`, `tasks` (the ids), `at`; `group-check` with `commands` (`{ command, exitCode }[]`) and `passed`; `rework` with `task` and `reason`; and `group-ended` with `status`, `tasks` (`{ task, status, runs }[]`) and `changed`. Task events inside a group SHALL carry `group`, and `loop` SHALL be the task loop's id.

#### Scenario: A group's stream
- **WHEN** a two-task group converges with its check passing
- **THEN** the events SHALL include, in order, `group-started`, the task events for `1.1` and `1.2` each with `group` `1`, a `group-check` with `passed` `true`, and `group-ended` with `status` `"converged"`

### Requirement: A group runs in one worktree
With `--worktree`, a group SHALL run in one worktree `<worktreeDir>/<change-id>-<group>` on branch `task/<change-id>/<group>`, under the same rules as a task's worktree: never reused or clobbered, the change committed at `HEAD`, setup before the loop, an explicit `--db`, and the worktree remembered for `resume` and `status`. Every task loop of the group SHALL run in that worktree.

#### Scenario: A group runs in its own worktree
- **WHEN** `run add-group-loop 2 --worktree --db group-2.sqlite` converges
- **THEN** the worktree `../agentscript-worktrees/add-group-loop-2` SHALL exist on branch `task/add-group-loop/2`, holding every task's edits and ticks, and the main tree SHALL be unchanged

### Requirement: groupScript names a bundled script or a file
A `groupScript` value of `group` SHALL select the bundled `group.agent`. Any other value SHALL be read as a path to a `.agent` file. A path that does not exist MUST refuse the run with exit `2`, naming it.

#### Scenario: A missing group script is refused
- **WHEN** `run fixture-live-task 1 --db loops.sqlite --group-script ./nope.agent` starts
- **THEN** stderr SHALL name `./nope.agent`, and the exit code SHALL be `2`

### Requirement: The live run also proves a group
`pnpm test:live` SHALL also run a fixture change with a two-task group, headless on the repo config, under the same time limit and process-group kill as the task run, and expect exit `0`, a `group-ended` event with `status` `"converged"`, and both tasks ticked.

#### Scenario: A live group converges
- **WHEN** `pnpm test:live` runs the group fixture
- **THEN** the group SHALL converge with both of its tasks ticked
