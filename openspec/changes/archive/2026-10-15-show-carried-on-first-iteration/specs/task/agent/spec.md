## ADDED Requirements

### Requirement: The bundled task scripts show carried feedback whenever it is non-empty
The orient prompts of `task.agent` and `task-delegate.agent` SHALL contain the `carried` text on any iteration where `carried` is non-empty, including the first iteration of a run resumed by an answer, after `Carried in (still unmet from an earlier iteration, or the principal's answer): `. When `carried` is empty they SHALL contain no `Carried in` line.

#### Scenario: task.agent shows an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task.agent` whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its orient step is composed for iteration `1`
- **THEN** the orient prompt SHALL contain `Use the v2 API`

#### Scenario: task-delegate.agent shows an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task-delegate.agent` with a `claude_code` grant whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its orient step is composed for iteration `1`
- **THEN** the orient prompt SHALL contain `Use the v2 API` and `the last approach did not work`

#### Scenario: A fresh run's first iteration shows no carried line
- **GIVEN** a fresh run of the bundled `task.agent`, and one of `task-delegate.agent`, each seeded with `carried` `""`
- **WHEN** each orient step is composed for iteration `1`
- **THEN** neither orient prompt SHALL contain `Carried in` or `This is iteration`
