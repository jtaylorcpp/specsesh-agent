## MODIFIED Requirements

### Requirement: Ticking never writes in doubt and never unticks
The loop MUST NOT write `tasks.md` when it came from text, when the task's line is already ticked, or when the line can no longer be found by id. In each case `TaskOutcome.ticked` SHALL be false, with a note in the loop's notes saying why. No task loop SHALL ever untick a task; only a group loop's rework does (see `task/group`).

#### Scenario: Text input is never written
- **GIVEN** a loop whose `tasks` was `{ text }`
- **WHEN** it converges
- **THEN** no file SHALL be written and `ticked` SHALL be `false`

#### Scenario: A file changed meanwhile is not written
- **GIVEN** a converged loop whose tasks.md no longer contains a line for `2.4`
- **WHEN** the loop tries to tick
- **THEN** the file SHALL be unchanged and `ticked` SHALL be `false`, with a note naming `2.4`
