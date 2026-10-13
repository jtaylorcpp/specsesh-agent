## MODIFIED Requirements

### Requirement: The task config has a fixed set of typed fields
The `task` object SHALL accept only these fields, all optional: strings `changesDir`, `db`, `provider`, `model`, `script`, `groupScript` and `worktreeDir`; string arrays `checks`, `allow` and `worktreeSetup`; positive integers `maxIterations` and `maxReworks`; booleans `requireCleanTree`, `worktree` and `deleteFiles`; and `escalateTo`, `"principal"` or `"agent"`. `deleteFiles` (default `false`, no flag or environment variable) SHALL reach `taskLoopExtensions` and `startTaskLoop`.

#### Scenario: An empty task object is valid
- **GIVEN** `{ "task": {} }`
- **WHEN** the config is read
- **THEN** it SHALL be accepted and every value SHALL fall back to its default

#### Scenario: A mistyped grant is refused
- **GIVEN** `{ "task": { "deleteFiles": "yes" } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL contain the config's path and `task.deleteFiles must be a boolean`, the exit code SHALL be `2`, and no database SHALL be opened

#### Scenario: A config without the grant binds no delete
- **GIVEN** a config whose `task` has no `deleteFiles`
- **WHEN** `run` starts a loop
- **THEN** the loop's stored `deleteFiles` SHALL be `false` and its harness registry SHALL hold no `delete_file` action

#### Scenario: Resume keeps the grant the loop started with
- **GIVEN** a loop started under a config with `"deleteFiles": true`, after which `deleteFiles` is removed from the config
- **WHEN** `agentscript-task resume <loop>` runs
- **THEN** the rebuilt harness SHALL bind `delete_file`

### Requirement: This repo ships a config for its own tasks
The repository root SHALL hold `agentscript.config.json` configuring this repo's own tasks: the `claude-code` provider running `task-delegate` on Opus, a `claude_code` delegate granted on Opus, this repo's checks and allowlist, a gitignored database, a prefer-offline install as worktree setup (pnpm keeps one store per filesystem, so a worktree elsewhere may need to download), and the `delete_file` grant. It SHALL hold exactly the values the scenario lists.

#### Scenario: The shipped config is valid
- **WHEN** the repo's `agentscript.config.json` is read
- **THEN** it SHALL be accepted; `task` SHALL be exactly `changesDir` `openspec/changes`, `db` `.agentscript/task-loops.sqlite`, `provider` `claude-code`, `model` `opus`, `script` `task-delegate`, `checks` `["pnpm check", "pnpm test"]`, `allow` `["pnpm", "node"]`, `maxIterations` `8`, `escalateTo` `principal`, `requireCleanTree` `true`, `worktreeSetup` `["pnpm install --frozen-lockfile --prefer-offline"]` and `deleteFiles` `true`
- **AND** `delegates` SHALL be exactly `{ claude_code: { runner: "claude-code", model: "opus", allow: ["pnpm", "node"], context: ["CLAUDE.md"] } }`
