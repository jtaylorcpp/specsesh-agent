## MODIFIED Requirements

### Requirement: The repo config is found by walking up
`agentscript-task` SHALL read the nearest `agentscript.config.json`, found by checking the current directory and then each parent up to the filesystem root. With none found, every value falls back to its flag or default and nothing is granted. Only the file's `task` and `delegates` objects SHALL be read; other top-level keys are ignored.

#### Scenario: A config in a parent directory is found
- **GIVEN** `agentscript.config.json` in the repo root and the CLI run from `packages/agent`
- **WHEN** `run` resolves its options
- **THEN** it SHALL use the repo root's config

#### Scenario: No config means defaults
- **GIVEN** no `agentscript.config.json` in the directory or any parent
- **WHEN** `run` is given every required flag
- **THEN** it SHALL run with the CLI defaults

#### Scenario: No config grants nothing
- **GIVEN** no `agentscript.config.json` and `--script task-delegate`
- **WHEN** `run` starts
- **THEN** it SHALL exit `2` naming `delegate/claude_code` and `no delegates are granted`

### Requirement: The task config has a fixed set of typed fields
The `task` object SHALL accept only these fields, all optional: strings `changesDir`, `db`, `provider`, `model`, `script`, `groupScript` and `worktreeDir`; string arrays `checks`, `allow` and `worktreeSetup`; positive integers `maxIterations` and `maxReworks`; booleans `requireCleanTree` and `worktree`; and `escalateTo`, `"principal"` or `"agent"`.

#### Scenario: An empty task object is valid
- **GIVEN** `{ "task": {} }`
- **WHEN** the config is read
- **THEN** it SHALL be accepted and every value SHALL fall back to its default

### Requirement: Values resolve flag, then environment, then config, then default
Each value SHALL resolve separately: its flag when given, else its environment variable where one exists (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`), else the config field, else the default: provider `anthropic`, model `claude-haiku-4-5`, script `task`, `groupScript` `group`, `maxIterations` `8`, `maxReworks` `2`, `escalateTo` `"principal"`, `requireCleanTree` `true`, `changesDir` `openspec/changes`, and no delegates.

#### Scenario: The environment beats the config
- **GIVEN** a config with `"model": "claude-haiku-4-5"` and `AGENTSCRIPT_MODEL=sonnet`
- **WHEN** `run` starts without `--model`
- **THEN** the model SHALL be `sonnet`

#### Scenario: Unset fields fall through independently
- **GIVEN** a config with only `"checks": ["pnpm test"]`
- **WHEN** `run` starts with `--max-iterations 5`
- **THEN** `checks` SHALL come from the config and `maxIterations` SHALL be `5`

#### Scenario: The iteration budget defaults to eight
- **GIVEN** a config with no `maxIterations`
- **WHEN** `run` starts without `--max-iterations`
- **THEN** `budget.maxIterations` SHALL be `8`

### Requirement: Config paths are relative to the config file
`changesDir`, `db`, a `script` path and each grant's `context` entry SHALL be resolved against the directory holding `agentscript.config.json`, not the current directory. The database's parent directory SHALL be created if it does not exist.

#### Scenario: The database path is anchored at the config
- **GIVEN** the repo root's config with `"db": ".agentscript/task-loops.sqlite"` and the CLI run from `packages/agent`
- **WHEN** `run` opens the database
- **THEN** it SHALL open `<repo root>/.agentscript/task-loops.sqlite`, creating `.agentscript/` if missing

#### Scenario: A grant's context is anchored at the config
- **GIVEN** the repo root's config granting `claude_code` with `"context": ["CLAUDE.md"]` and the CLI run from `packages/agent`
- **WHEN** the delegate runs
- **THEN** it SHALL be given `<repo root>/CLAUDE.md`

### Requirement: This repo ships a config for its own tasks
The repository root SHALL hold `agentscript.config.json` configuring this repo's own tasks: the `claude-code` provider running `task-delegate` on Opus, a `claude_code` delegate granted on Opus, this repo's checks and allowlist, a gitignored database, and a prefer-offline install as worktree setup (pnpm keeps one store per filesystem, so a worktree elsewhere may need to download). It SHALL hold exactly the values the scenario lists.

#### Scenario: The shipped config is valid
- **WHEN** the repo's `agentscript.config.json` is read
- **THEN** it SHALL be accepted; `task` SHALL be exactly `changesDir` `openspec/changes`, `db` `.agentscript/task-loops.sqlite`, `provider` `claude-code`, `model` `opus`, `script` `task-delegate`, `checks` `["pnpm check", "pnpm test"]`, `allow` `["pnpm", "node"]`, `maxIterations` `8`, `escalateTo` `principal`, `requireCleanTree` `true` and `worktreeSetup` `["pnpm install --frozen-lockfile --prefer-offline"]`
- **AND** `delegates` SHALL be exactly `{ claude_code: { runner: "claude-code", model: "opus", allow: ["pnpm", "node"], context: ["CLAUDE.md"] } }`

## ADDED Requirements

### Requirement: The delegates config is a map of grants checked whole
A top-level `delegates` object SHALL map grant names to `DelegateGrant` objects (`actions/delegation`). An invalid grant MUST make the CLI exit `2` before any database is opened, printing the config path and naming the grant and the key. The resolved grants SHALL reach the loop as `delegates`.

#### Scenario: A misspelled grant key is refused
- **GIVEN** `{ "delegates": { "claude_code": { "runner": "claude-code", "modle": "opus" } } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `claude_code`, `modle` and the config's path, and the exit code SHALL be `2`

#### Scenario: Grants reach the loop
- **GIVEN** a config granting `claude_code` with `model` `"opus"`
- **WHEN** `run` starts a loop
- **THEN** the loop's stored `delegates` SHALL hold `claude_code` with `model` `"opus"`

### Requirement: The retired delegate fields are refused, saying where they moved
A `task` object holding `delegateModel` or `delegateContext` MUST make the CLI exit `2` before any database is opened, naming the key and saying `moved: grant a delegate under "delegates" instead`.

#### Scenario: An old config is refused with directions
- **GIVEN** `{ "task": { "delegateModel": "sonnet" } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `delegateModel` and contain `grant a delegate under "delegates" instead`, and the exit code SHALL be `2`
