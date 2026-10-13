## MODIFIED Requirements

### Requirement: agentscript-change takes a command and a change
`agentscript-change` SHALL take a command and a change id under the config's `changesDir`. Any other command, or none, MUST print usage to stderr and exit `2`, one line per command as the scenario "No command prints usage" lists them. It SHALL resolve the database, provider and model as `agentscript-task` does, read no stdin, never prompt, and exit `2` on a refusal.

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]`, `agentscript-change approve <change> [--principal <name>] [--db <path>]`, `agentscript-change build <change> [<answer>] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]` and `agentscript-change close <change> [--db <path>]`

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate add-plan-export`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: Build output ends with the next command
The output SHALL start `# <change> — <state>`, then `## group <n>: <status> (<k> tasks, <r> reworks)` per group entered, then `## change check: passed` or the failing command and its output, then `## unclaimed: <n>` and each scenario when any. A blocked build SHALL end with the question and `pnpm change build <change> "<answer>"`; a built one with `pnpm change close <change>`. Built SHALL exit `0`, anything else `1`.

#### Scenario: A blocked build ends with the answer command
- **WHEN** a build of `add-plan-export` ends blocked asking `Which API?`
- **THEN** the output SHALL end with `Which API?` and `pnpm change build add-plan-export "<answer>"`

#### Scenario: A built change points at the next step
- **WHEN** a build of `add-plan-export` ends `converged`
- **THEN** the output SHALL contain `## change check: passed` and end with `pnpm change close add-plan-export`

## ADDED Requirements

### Requirement: close refuses an unfinished change
`close <change>` SHALL exit `2`, changing nothing, for a change with an unticked task in `tasks.md`, listing them; one whose newest change loop in the database ended other than `converged`, naming that loop's state; and one that fails `openspec validate <change> --strict`, naming the first issue.

#### Scenario: An unticked task refuses close
- **GIVEN** `add-plan-export` whose task `2.3` is unticked
- **WHEN** `close add-plan-export` runs
- **THEN** it SHALL exit `2` listing `2.3`, and `openspec/` SHALL be unchanged

#### Scenario: A waiting build refuses close
- **GIVEN** `add-plan-export` whose tasks are all ticked, and whose newest change loop is `blocked`
- **WHEN** `close add-plan-export` runs
- **THEN** it SHALL exit `2` saying the build is waiting for an answer

### Requirement: close folds the change through a trial first
`close` SHALL copy `openspec/` to a temporary directory, run `openspec archive <change> --yes` there and `openspec validate --specs --strict` on the result, and only when both pass run `openspec archive <change> --yes` in the repository, all with `OPENSPEC_TELEMETRY=0`. A failed trial SHALL exit `2` with `openspec/` unchanged. It SHALL print the capabilities folded into and the archive directory, end with `git add -A openspec && git commit`, and SHALL NOT commit.

#### Scenario: A finished change is folded
- **GIVEN** `add-plan-export` with every task ticked, whose newest change loop converged
- **WHEN** `close add-plan-export` runs
- **THEN** its requirements SHALL be in `openspec/specs/`, its directory SHALL be under `openspec/changes/archive/`, and the exit code SHALL be `0`

#### Scenario: A fold that breaks the specs is refused
- **GIVEN** a MODIFIED requirement that passes in the change but is over the length limit once merged
- **WHEN** `close` runs
- **THEN** it SHALL exit `2`, and `openspec/` SHALL be unchanged
