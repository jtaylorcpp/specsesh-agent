# openspec/size Specification

## Purpose
How big a change and its tasks may be: a size budget, the counts it is checked against, and pure rules that report every overrun as a validation issue with a suggested split.

## Requirements

### Requirement: A size budget has fixed limits with defaults
The model SHALL define `SizeBudget` as `{ capabilities, requirements, scenarios, groups, tasks, taskFiles, taskChars, testScenarios }`, each a positive integer, and `DEFAULT_SIZE_BUDGET` as `2`, `6`, `16`, `4`, `12`, `1`, `240` and `4` in that order. Every size rule SHALL take an optional budget, defaulting to `DEFAULT_SIZE_BUDGET`, and report overruns as `WARNING` issues.

#### Scenario: The default budget
- **WHEN** `DEFAULT_SIZE_BUDGET` is read
- **THEN** it SHALL equal `{ capabilities: 2, requirements: 6, scenarios: 16, groups: 4, tasks: 12, taskFiles: 1, taskChars: 240, testScenarios: 4 }` and pass the `SizeBudget` check

#### Scenario: An oversized change fails strict validation
- **GIVEN** a change with 7 requirements
- **WHEN** `strictlyValid(sizeIssues(change))` is evaluated
- **THEN** it SHALL be `false`

### Requirement: A change's size counts its capabilities, deltas and tasks
`changeSize(change)` SHALL return `{ capabilities, requirements, scenarios, groups, tasks }`: distinct capability paths across the proposal and the deltas; one requirement per delta; the scenarios of ADDED and MODIFIED deltas; and the groups and tasks of `change.tasks`, zero when it is absent.

#### Scenario: Counting a change
- **GIVEN** a change over two capabilities with three ADDED deltas of two scenarios each, one REMOVED delta, and two groups holding five tasks
- **WHEN** `changeSize` is called
- **THEN** it SHALL return `{ capabilities: 2, requirements: 4, scenarios: 6, groups: 2, tasks: 5 }`

### Requirement: A change over budget is reported per limit, with a split
`sizeIssues(change, budget?)` SHALL return one `WARNING` per count over its limit, naming the count and the limit, with path `proposal.md`, `specs` or `tasks.md`. Too many capabilities SHALL suggest one change per capability, listing them; too many tasks or groups SHALL suggest one change per group, listing their titles.

#### Scenario: A change within budget has no issues
- **WHEN** a change at exactly every default limit is checked
- **THEN** `sizeIssues` SHALL return `[]`

#### Scenario: Each exceeded limit is its own issue
- **GIVEN** a change with 17 scenarios and 13 tasks
- **WHEN** `sizeIssues` is called
- **THEN** it SHALL return two issues, one naming `17` and `16`, the other `13` and `12`

#### Scenario: Split by capability
- **GIVEN** a change over `["task","cli"]`, `["task","group"]` and `["durable","host"]`
- **WHEN** `sizeIssues` is called
- **THEN** the capabilities issue SHALL list `task/cli`, `task/group` and `durable/host` as the changes to split into

#### Scenario: Split by group
- **GIVEN** a change of 13 tasks in groups `1. Model` and `2. Loop`
- **WHEN** `sizeIssues` is called
- **THEN** the tasks issue SHALL list `1. Model` and `2. Loop` as the changes to split into

### Requirement: A proposal is sized before any delta exists
`proposalSizeIssues(proposal, budget?)` SHALL return one `WARNING` with path `proposal.md` when `capabilities.new` and `capabilities.modified` together exceed `budget.capabilities`, listing the paths as the changes to split into, and `[]` otherwise.

#### Scenario: A proposal touching three capabilities
- **WHEN** a proposal with one new and two modified capabilities is checked
- **THEN** `proposalSizeIssues` SHALL return one issue listing all three paths

### Requirement: A task is one action on one file
`taskIssues(task, budget?)` SHALL return a `WARNING` with path `tasks.md#<id>` for each rule broken: more than `taskFiles` files, naming them; text spanning more than one line; text longer than `taskChars` characters; and, for a task with a `scenario-named` link, more than `testScenarios` claimed scenarios. A task naming no file SHALL pass the file rule.

#### Scenario: A task naming two files
- **WHEN** a task naming `src/a.ts` and `src/b.ts` is checked
- **THEN** one issue SHALL name both files

#### Scenario: A task with sub-steps
- **WHEN** a task whose text continues onto indented lines is checked
- **THEN** one issue SHALL say it spans more than one line

#### Scenario: A test task claiming five scenarios
- **WHEN** a task with five `scenario-named` links is checked
- **THEN** one issue SHALL name `5` and `4`

#### Scenario: A command task passes
- **WHEN** the task `pnpm check and pnpm test pass`, naming no file, is checked
- **THEN** `taskIssues` SHALL return `[]`
