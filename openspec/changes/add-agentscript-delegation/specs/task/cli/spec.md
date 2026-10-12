## MODIFIED Requirements

### Requirement: run maps its flags onto the task loop options
`run` SHALL pass `{ change: { dir }, task, script, workspace, budget, checks, allow, escalateTo, model, delegates }`, each from its flag, else the repo config (see `task/headless`), else its default: `--script <name|path>` (bundled `task`), `--workspace <dir>` (the current directory), repeatable `--check <command>` and `--allow <word>`, `--max-iterations <n>` (`budget.maxIterations`), `--escalate-to principal|agent`; `delegates` from the config only, or none under `--no-delegates`.

#### Scenario: Repeated checks are kept in order
- **WHEN** the CLI runs with `--check "pnpm test" --check "pnpm check"`
- **THEN** the loop's `checks` SHALL be `["pnpm test", "pnpm check"]`

#### Scenario: The workspace defaults to the current directory
- **WHEN** `run` is given no `--workspace`
- **THEN** the loop's `workspace` SHALL be the process's current directory

#### Scenario: A flag overrides the config
- **GIVEN** a repo config with `"checks": ["pnpm test"]`
- **WHEN** `run` is given `--check "pnpm check"`
- **THEN** the loop's `checks` SHALL be `["pnpm check"]`

## ADDED Requirements

### Requirement: --no-delegates withdraws every grant for one run
`run --no-delegates` SHALL start the loop with no delegates, whatever the config grants, so a script targeting `mcpTool://delegate/<name>` is refused at start (exit `2`) and a delegate-free script runs unchanged.

#### Scenario: A delegating script is refused without grants
- **GIVEN** the repo config granting `claude_code` and running `task-delegate`
- **WHEN** `run fixture-live-task 1.1 --db loops.sqlite --no-delegates` starts
- **THEN** stderr SHALL name `delegate/claude_code` and the exit code SHALL be `2`, with no loop created

#### Scenario: A delegate-free script still runs
- **GIVEN** the same config
- **WHEN** `run fixture-live-task 1.1 --db loops.sqlite --no-delegates --script task` starts
- **THEN** the loop SHALL start, with no `delegates` stored
