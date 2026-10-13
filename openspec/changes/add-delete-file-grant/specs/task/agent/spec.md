## MODIFIED Requirements

### Requirement: A harness binds the loop's actions to one workspace
`taskLoopExtensions({ workspace, checks, allow, delegates, runners, deleteFiles })` SHALL return `TaskLoop` and run and step extensions over `workspaceActions`, `delegationActions(delegates, { workspace, runners })` and, if `deleteFiles` is `true`, `deleteActions(workspace)`. `workspace` is a directory or a `Workspace`; `runners` defaults to `defaultRunners`. `startTaskLoop` SHALL check scripts against that registry and store `delegates`, `worktree` and `deleteFiles` in its input.

#### Scenario: The extensions run the loop's actions in its workspace
- **GIVEN** a harness with `taskLoopExtensions({ workspace, checks: ["pnpm test"], allow: ["pnpm"] })` installed
- **WHEN** a loop over that workspace edits a file
- **THEN** the file SHALL change inside `workspace`

#### Scenario: The delegate configuration is stored with the loop
- **GIVEN** options with `delegates` `{ claude_code: { runner: "claude-code", model: "opus" } }` and `worktree` `{ path: "/w", branch: "task/c/1.1" }`
- **WHEN** `startTaskLoop` creates the loop
- **THEN** the loop's stored input SHALL hold those two values

#### Scenario: A delegating script without a grant is refused at start
- **GIVEN** options running `task-delegate.agent` with no `delegates`
- **WHEN** `startTaskLoop` is called
- **THEN** it SHALL reject naming `delegate/claude_code` and `no delegates are granted`, and no loop SHALL be created

#### Scenario: The delete grant is stored and bound
- **GIVEN** a harness from `taskLoopExtensions({ workspace, deleteFiles: true })` and options with `deleteFiles` `true`
- **WHEN** `startTaskLoop` creates the loop and its script calls `delete_file` on `src/old.ts`
- **THEN** the loop's stored input SHALL hold `deleteFiles` `true`, and `src/old.ts` SHALL be removed from `workspace`

## ADDED Requirements

### Requirement: An ungranted delete_file is an optional target
The start-up binding check SHALL treat an unbound `delete_file`, and no other name, as optional: the script is not refused. Unbound, it SHALL be left out of a model step's offered tools, and a deterministic call SHALL answer `ok: false` with `delete_file is not granted: set "deleteFiles": true under "task" in agentscript.config.json`. The loop SHALL seed boolean `delete_granted`, true exactly when `delete_file` is bound, only into scripts declaring it.

#### Scenario: A model step is not offered an ungranted delete
- **GIVEN** a harness without `deleteFiles` and the bundled `task.agent`
- **WHEN** the loop starts and the act step is dispatched
- **THEN** the start SHALL NOT be refused, `delete_granted` SHALL be seeded `False`, and the offered tools SHALL be `read_file`, `edit_file` and `run_command` only

#### Scenario: A deterministic ungranted delete is retried with the message
- **GIVEN** a harness without `deleteFiles`, a budget of `8`, and a custom script that does not declare `delete_granted` and deterministically runs `delete_file` on `src/legacy.ts`
- **WHEN** iteration 1 reaches that call
- **THEN** the start SHALL NOT have been refused, the call SHALL answer `ok` false, and iteration 2 SHALL start with `carried` containing `delete_file is not granted: set "deleteFiles": true under "task" in agentscript.config.json`

### Requirement: task.agent can delete when granted
Both bundled scripts SHALL declare `delete_granted: mutable boolean = False`. `task.agent`'s act step SHALL name the tools `read_file`, `edit_file`, `run_command` and `delete_file`, and its orient prompt SHALL contain `If the task retires a file, delete it with delete_file; do not empty it.` exactly when `delete_granted` is true.

#### Scenario: Granted, orient asks for deletion
- **GIVEN** a harness with `deleteFiles` `true`
- **WHEN** `task.agent`'s orient step is composed and its act step dispatched
- **THEN** the orient prompt SHALL contain `If the task retires a file, delete it with delete_file; do not empty it.` and the act step SHALL be offered `delete_file`

#### Scenario: Not granted, orient says nothing of deletion
- **GIVEN** a harness without `deleteFiles`
- **WHEN** `task.agent`'s orient step is composed
- **THEN** its prompt SHALL NOT contain `delete_file`

### Requirement: task-delegate.agent's outer step deletes what the delegate retires
When `delete_granted` is true, `task-delegate.agent`'s orient prompt SHALL tell the planner to end the plan it hands the delegate with `You cannot delete files.` and a request for one line `RETIRE: <path>` per retired file (delegation takes only `instructions`, and a script cannot join strings, so the planner carries it); a model step `retire` SHALL set `retire_path` to the first such path, or `""`; a non-empty `retire_path` SHALL be passed to a deterministic `delete_file`, recorded in the iteration as an `edit` action. When false, neither happens. The judge prompt SHALL contain `Files deleted: ` then `retire_path`, or `none`.

#### Scenario: The delegate's retired file is deleted
- **GIVEN** `deleteFiles` `true` and a fake `claude` whose reply ends `RETIRE: packages/agent/src/old-workspace.ts`
- **WHEN** iteration 1 runs
- **THEN** that file SHALL be gone, the stream SHALL hold an `action` event with `kind` `"edit"`, `summary` `"delete_file packages/agent/src/old-workspace.ts"` and that path in `refs`, and the judge prompt SHALL contain `Files deleted: packages/agent/src/old-workspace.ts`

#### Scenario: One file is retired per iteration
- **GIVEN** `deleteFiles` `true` and a fake `claude` whose reply ends `RETIRE: src/a.ts` then `RETIRE: src/b.ts`
- **WHEN** iteration 1 runs
- **THEN** `src/a.ts` SHALL be gone and `src/b.ts` SHALL remain

#### Scenario: Not granted, the delegate is not asked to retire
- **GIVEN** a harness without `deleteFiles` and a `claude_code` grant
- **WHEN** an iteration of `task-delegate.agent` runs
- **THEN** the start SHALL NOT be refused, the orient prompt SHALL NOT contain `RETIRE:`, no `retire` step or `delete_file` call SHALL run, and the judge prompt SHALL contain `Files deleted: none`
