## MODIFIED Requirements

### Requirement: The delegate script shows the judge what changed and changes approach
`task-delegate.agent` SHALL set `act_files` from the delegate's `files_changed`. Its judge prompt SHALL state that count; when it is `0` and `changed` is empty, it SHALL say the delegate changed nothing and the work has not been done, and otherwise that earlier iterations may already have done the work. Its orient step SHALL say that when the carried feedback names a check that already failed before, a different approach is needed.

#### Scenario: The judge sees an idle delegate
- **GIVEN** a fake `claude` that writes no file, in a loop whose first iteration this is
- **WHEN** an iteration of `task-delegate.agent` reaches its judge step
- **THEN** the judge's prompt SHALL contain the line `Files the delegate changed in this iteration: 0 (-1 means unknown). 0 means the delegate changed nothing.`
- **AND** it SHALL contain the line `No file has changed since the loop started either, so the work has not been done: a report that it already exists is wrong unless the check output shows the task's scenario passing.`
- **AND** it SHALL NOT contain `0 alone does not mean the task is unfinished`

#### Scenario: The judge sees an idle delegate after earlier changes
- **GIVEN** `task-delegate.agent`'s judge step composed with `act_files` `0` and `changed` `src/a.ts`
- **WHEN** its prompt is rendered
- **THEN** it SHALL contain `Files the delegate changed in this iteration: 0 (-1 means unknown). Earlier iterations may already have done the work, so 0 alone does not mean the task is unfinished.`
- **AND** it SHALL NOT contain `0 means the delegate changed nothing`

#### Scenario: The judge sees a delegate that changed files
- **GIVEN** `task-delegate.agent`'s judge step composed with `act_files` `2` and `changed` empty
- **WHEN** its prompt is rendered
- **THEN** it SHALL contain `Files the delegate changed in this iteration: 2 (-1 means unknown).`
- **AND** it SHALL NOT contain `0 means the delegate changed nothing`

#### Scenario: Orient asks for a different approach
- **WHEN** `task-delegate.agent`'s orient step is composed for iteration `2`
- **THEN** its prompt SHALL contain `the last approach did not work`
