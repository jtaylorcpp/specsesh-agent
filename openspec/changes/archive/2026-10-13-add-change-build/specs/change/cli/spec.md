## MODIFIED Requirements

### Requirement: agentscript-change takes a command and a change
`agentscript-change` SHALL take a command and a change id under the config's `changesDir`. Any other command, or none, MUST print usage to stderr and exit `2`, one line per command as the scenario "No command prints usage" lists them. It SHALL resolve the database, provider and model as `agentscript-task` does, read no stdin, never prompt, and exit `2` on a refusal.

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL begin with `usage:` and the exit code SHALL be `2`
- **AND** stderr SHALL list `agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]`, `agentscript-change approve <change> [--principal <name>] [--db <path>]` and `agentscript-change build <change> [<answer>] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]`

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate add-plan-export`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: Draft output ends with the next command
The output SHALL start `# <change> — <state>`, then `## <stage>: approved` per approved stage, then the current stage's `### <stage> draft <n>` lines. A review SHALL end with its files, `pnpm change draft <change> "<what to change>"` and `pnpm change approve <change>`; a question with it and `pnpm change draft <change> "<answer>"`, exiting `1`; a drafted change with `pnpm change build <change>`.

#### Scenario: A review ends with both commands
- **WHEN** a draft of `add-plan-export` ends waiting for review of `proposal.md`
- **THEN** the output SHALL end with `pnpm change draft add-plan-export "<what to change>"` and `pnpm change approve add-plan-export`

#### Scenario: A question exits 1
- **WHEN** a draft ends waiting on the question `CSV too?`
- **THEN** the output SHALL end with `CSV too?` and `pnpm change draft add-plan-export "<answer>"`, and the exit code SHALL be `1`

#### Scenario: A drafted change points at the next step
- **WHEN** a draft of `add-plan-export` ends `converged`
- **THEN** the output SHALL end with `pnpm change build add-plan-export`

## ADDED Requirements

### Requirement: build starts a change's build
With no change loop of the change waiting for an answer, `build <change>` SHALL start a change loop and wait for it, mapping the flags a group run takes, plus `--change-check <command>` (repeatable), onto its options. A dirty tree without `--allow-dirty`, a refusal by the loop's guard, `--worktree`, or an answer with nothing waiting SHALL exit `2` and start nothing. A change whose latest change loop converged SHALL start nothing.

#### Scenario: A build runs every group in order
- **GIVEN** a change with groups `1` and `2`, whose tasks converge on a faux model, and passing checks
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL list group `1` then group `2` as converged, and the exit code SHALL be `0`

#### Scenario: A dirty tree refuses build
- **GIVEN** an uncommitted edit in the repository
- **WHEN** `build add-plan-export` runs without `--allow-dirty`
- **THEN** it SHALL exit `2` naming `--allow-dirty`, and start nothing

#### Scenario: A refused guard exits 2
- **WHEN** `build add-plan-export` runs and a requirement of its deltas has no scenario
- **THEN** it SHALL exit `2` naming that requirement, and no loop SHALL exist

#### Scenario: A built change starts nothing
- **GIVEN** `add-plan-export` whose latest change loop converged
- **WHEN** `build add-plan-export` runs
- **THEN** no loop SHALL start, and the output SHALL say it is built

### Requirement: build with an answer continues a waiting build
When the change's latest change loop ended `blocked`, `build <change> <answer>` SHALL answer it as the escalation's `to` with the answer as the decision, wait for the new run and print it. Without an answer it SHALL print the question again, start nothing, and exit `1`.

#### Scenario: Answering a waiting build continues it
- **GIVEN** `add-plan-export` blocked in group `2` of three, asking `Which API?`
- **WHEN** `build add-plan-export "Use the v2 API"` runs and the build converges
- **THEN** the output SHALL list groups `1`, `2` and `3` as converged

#### Scenario: build alone shows the question
- **GIVEN** `add-plan-export` blocked asking `Which API?`
- **WHEN** `build add-plan-export` runs
- **THEN** the output SHALL contain `Which API?`, no loop SHALL start, and the exit code SHALL be `1`

### Requirement: Build output ends with the next command
The output SHALL start `# <change> — <state>`, then `## group <n>: <status> (<k> tasks, <r> reworks)` per group entered, then `## change check: passed` or the failing command and its output, then `## unclaimed: <n>` and each scenario when any. A blocked build SHALL end with the question and `pnpm change build <change> "<answer>"`; a built one with `pnpm spec:archive <change>`. Built SHALL exit `0`, anything else `1`.

#### Scenario: A blocked build ends with the answer command
- **WHEN** a build of `add-plan-export` ends blocked asking `Which API?`
- **THEN** the output SHALL end with `Which API?` and `pnpm change build add-plan-export "<answer>"`

#### Scenario: A built change points at the next step
- **WHEN** a build of `add-plan-export` ends `converged`
- **THEN** the output SHALL contain `## change check: passed` and end with `pnpm spec:archive add-plan-export`
