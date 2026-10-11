## MODIFIED Requirements

### Requirement: Values resolve flag, then environment, then config, then default
Each value SHALL resolve separately: its flag when given, else its environment variable where one exists (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`), else the config field, else the default: provider `anthropic`, model `claude-haiku-4-5`, `delegateModel` the resolved model, script `task`, `groupScript` `group`, `maxIterations` `8`, `maxReworks` `2`, `escalateTo` `"principal"`, `requireCleanTree` `true`, `changesDir` `openspec/changes`.

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

### Requirement: This repo ships a config for its own tasks
The repository root SHALL hold `agentscript.config.json` configuring this repo's own tasks: the `claude-code` provider running `task-delegate` on Opus, this repo's checks and allowlist, a gitignored database, `CLAUDE.md` as delegate context, and a prefer-offline install as worktree setup (pnpm keeps one store per filesystem, so a worktree elsewhere may need to download). Its `task` object SHALL hold exactly the values the scenario lists.

#### Scenario: The shipped config is valid
- **WHEN** the repo's `agentscript.config.json` is read
- **THEN** it SHALL be accepted, and `task` SHALL be exactly `changesDir` `openspec/changes`, `db` `.agentscript/task-loops.sqlite`, `provider` `claude-code`, `model` `opus`, `delegateModel` `opus`, `script` `task-delegate`, `checks` `["pnpm check", "pnpm test"]`, `allow` `["pnpm", "node"]`, `maxIterations` `8`, `escalateTo` `principal`, `delegateContext` `["CLAUDE.md"]`, `requireCleanTree` `true` and `worktreeSetup` `["pnpm install --frozen-lockfile --prefer-offline"]`
