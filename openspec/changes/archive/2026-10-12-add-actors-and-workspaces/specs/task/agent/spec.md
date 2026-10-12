## MODIFIED Requirements

### Requirement: A harness binds the loop's actions to one workspace
`taskLoopExtensions({ workspace, checks, allow, delegates, runners })` SHALL return `TaskLoop` and the run and step extensions over `workspaceActions` plus `delegationActions(delegates, { workspace, runners })`; `workspace` is a directory (made `localWorkspace`) or a `Workspace`, `runners` defaults to `defaultRunners`. `startTaskLoop` SHALL check scripts against that registry, and store `delegates` and `worktree` in its input.

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

### Requirement: Options name the change, the task, the script and the workspace
`TaskLoopOptions` SHALL be `{ change, task: TaskId, script?: Source, workspace: string, budget?: { maxIterations: number }, checks?: string[], allow?: string[], escalateTo?: Recipient, model?: ModelRef, delegates?: DelegateGrants, worktree?: { path, branch } }`. `change` SHALL be `{ dir: string }` or `{ proposal: Source, design?: Source, deltas: Source[], tasks: Source }`. `Source` SHALL be `{ text: string }` or `{ path: string }`.

#### Scenario: A change given as texts
- **WHEN** `change` is `{ proposal: { text }, deltas: [{ text }], tasks: { text } }`
- **THEN** the loop SHALL start without reading any file for the change

#### Scenario: A change given by directory
- **WHEN** `change` is `{ dir: "openspec/changes/archive/2026-10-11-baseline-agentscript-durable" }`
- **THEN** the loop SHALL read that directory's artifacts as described in the change directory requirement

### Requirement: The bundled scripts are the default and the subscription variant
The package SHALL ship `task.agent` (orient, act with model-callable `read_file`, `edit_file`, `run_command`, check with deterministic `run_checks`, judge), delegate-free, as the default, and `task-delegate.agent`, acting through the deterministic `mcpTool://delegate/claude_code`, for providers without model-callable tools; it runs only with a `claude_code` grant. Both MUST satisfy the contract, lint clean, and judge iterate-first.

#### Scenario: The bundled scripts lint clean
- **WHEN** the shipped `task.agent` and `task-delegate.agent` are analysed
- **THEN** each SHALL have zero diagnostics and pass the contract check

#### Scenario: Only the delegate script delegates
- **WHEN** the shipped scripts' action targets are read
- **THEN** `task.agent` SHALL target no `mcpTool://delegate/` name, and `task-delegate.agent` SHALL target exactly `mcpTool://delegate/claude_code`

### Requirement: A run ended by a failed action is retried within budget
When a child run ends `"failed"` because a host action failed (its last report is an action result with `ok` false, such as a delegate timeout), the iteration SHALL be recorded unmet with that action's message as reason, an `"environment"` finding and `retry` feedback; the loop iterates with `carried` that message, or exhausts by budget.

#### Scenario: A delegate timeout costs one iteration
- **GIVEN** a budget of `8`
- **WHEN** iteration 1's run ends failed because `delegate/claude_code` answered `ok` false with `Claude Code timed out after 900000ms`
- **THEN** iteration 2 SHALL start with `carried` containing `timed out after 900000ms`, and the loop SHALL NOT end `"failed"`

#### Scenario: A failed action on the last iteration exhausts
- **GIVEN** `budget.maxIterations` `1`
- **WHEN** iteration 1's run ends failed because an action failed
- **THEN** the loop SHALL end `"exhausted"`

#### Scenario: A failed step still fails the loop
- **WHEN** iteration 1's run ends failed because its judge step failed with category `rate_limit`
- **THEN** the loop SHALL end `"failed"`

## ADDED Requirements

### Requirement: The delegate script shows the judge what changed and changes approach
`task-delegate.agent` SHALL set `act_files` from the delegate's `files_changed`, and its judge prompt SHALL contain `Files the delegate changed: ` followed by that number. Its orient step SHALL say that when the carried feedback names a check that already failed before, the last approach did not work and a different one is needed.

#### Scenario: The judge sees an idle delegate
- **GIVEN** a fake `claude` that writes no file
- **WHEN** an iteration of `task-delegate.agent` reaches its judge step
- **THEN** the judge's prompt SHALL contain `Files the delegate changed: 0`

#### Scenario: Orient asks for a different approach
- **WHEN** `task-delegate.agent`'s orient step is composed for iteration `2`
- **THEN** its prompt SHALL contain `the last approach did not work`
