## RENAMED Requirements

- FROM: `### Requirement: A group outcome has one entry per task`
- TO: `### Requirement: A group outcome has one entry per task that was ticked or ran`

## MODIFIED Requirements

### Requirement: A group outcome has one entry per task that was ticked or ran
The model SHALL define `GroupOutcome` as `{ group: integer, tasks: { task: TaskId, outcome: LoopOutcome<TaskOutcome>, runs: integer }[] }`, with one entry per task that was ticked before the loop or whose loop ran, in group order; a task still queued when the group ends early has no entry. `outcome` SHALL be the task's latest run, whatever its status; `runs` counts its loop's runs in this group loop, `0` if ticked before it began.

#### Scenario: A reworked task appears once
- **GIVEN** task `2.4` whose loop converged, was reopened by `"rework-task"`, and converged again
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold one entry for `2.4`, with `runs` `2` and the second run's `outcome`

#### Scenario: A task that never converged is still listed
- **WHEN** a task's loop ends `"exhausted"`
- **THEN** the group outcome SHALL hold its entry, with `outcome.status` `"exhausted"`

#### Scenario: A task still queued when the group ends has no entry
- **GIVEN** group `2` whose task `2.2` blocks while `2.3` is still queued
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold `2.1` and `2.2` and no entry for `2.3`, and `2.3` SHALL still be unticked in `tasks.md`

#### Scenario: A task ticked before the group loop has no runs
- **GIVEN** task `2.1` ticked before group `2`'s loop starts
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold `2.1` with `runs` `0` and `outcome.status` `"converged"`
