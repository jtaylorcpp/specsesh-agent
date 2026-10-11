## MODIFIED Requirements

### Requirement: A harness binds the loop's actions to one workspace
`taskLoopExtensions({ workspace, checks, allow, delegateModel, delegateContext })` SHALL return `TaskLoop` and the two extensions `agentScriptExtensions` builds over the built-in actions for that configuration. A task-loop harness installs all three. `startTaskLoop` SHALL check the script's actions against the built-ins for the options' `workspace`, `checks` and `allow`, and store `delegateModel`, `delegateContext` and `worktree` in its input.

#### Scenario: The extensions run the loop's actions in its workspace
- **GIVEN** a harness with `taskLoopExtensions({ workspace, checks: ["pnpm test"], allow: ["pnpm"] })` installed
- **WHEN** a loop over that workspace edits a file
- **THEN** the file SHALL change inside `workspace`

#### Scenario: The delegate configuration is stored with the loop
- **GIVEN** options with `delegateModel` `"sonnet"`, `delegateContext` `["CLAUDE.md"]` and `worktree` `{ path: "/w", branch: "task/c/1.1" }`
- **WHEN** `startTaskLoop` creates the loop
- **THEN** the loop's stored input SHALL hold those three values

### Requirement: Options name the change, the task, the script and the workspace
`TaskLoopOptions` SHALL be `{ change, task: TaskId, script?: Source, workspace: string, budget?: { maxIterations: number }, checks?: string[], allow?: string[], escalateTo?: Recipient, model?: ModelRef, delegateModel?: string, delegateContext?: string[], worktree?: { path, branch } }`. `change` SHALL be `{ dir: string }` or `{ proposal: Source, design?: Source, deltas: Source[], tasks: Source }`. `Source` SHALL be `{ text: string }` or `{ path: string }`.

#### Scenario: A change given as texts
- **WHEN** `change` is `{ proposal: { text }, deltas: [{ text }], tasks: { text } }`
- **THEN** the loop SHALL start without reading any file for the change

#### Scenario: A change given by directory
- **WHEN** `change` is `{ dir: "openspec/changes/archive/2026-10-11-baseline-agentscript-durable" }`
- **THEN** the loop SHALL read that directory's artifacts as described in the change directory requirement
