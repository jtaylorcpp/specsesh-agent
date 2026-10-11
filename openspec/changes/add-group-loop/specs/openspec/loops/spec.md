## MODIFIED Requirements

### Requirement: A group outcome has one entry per task
The model SHALL define `GroupOutcome` as `{ group: integer, tasks: { task: TaskId, outcome: LoopOutcome<TaskOutcome>, runs: integer }[] }`, with exactly one entry per task, in group order. `outcome` SHALL be the task's latest run, whatever its status, and `runs` how many times its loop ran in this group loop, `0` for a task ticked before the group loop began. Earlier runs stay in their own iterations.

#### Scenario: A reworked task appears once
- **GIVEN** task `2.4` whose loop converged, was reopened by `"rework-task"`, and converged again
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold one entry for `2.4`, with `runs` `2` and the second run's `outcome`

#### Scenario: A task that never converged is still listed
- **WHEN** a task's loop ends `"exhausted"`
- **THEN** the group outcome SHALL hold its entry, with `outcome.status` `"exhausted"`

#### Scenario: A task ticked before the group loop has no runs
- **GIVEN** task `2.1` ticked before group `2`'s loop starts
- **WHEN** the group outcome is read
- **THEN** `tasks` SHALL hold `2.1` with `runs` `0` and `outcome.status` `"converged"`
