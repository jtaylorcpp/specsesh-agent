## MODIFIED Requirements

### Requirement: The bundled task scripts show carried feedback whenever it is non-empty
The orient and judge prompts of `task.agent` and `task-delegate.agent` SHALL contain the `carried` text whenever it is non-empty, including on the first iteration of a run resumed by an answer. The judge SHALL treat a principal's answer as settling the question it answers and not choose `ask` for it again; checks still decide done. When `carried` is empty neither prompt SHALL contain it.

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
- **WHEN** each orient and judge step is composed for iteration `1`
- **THEN** neither orient prompt SHALL contain `Carried in` or `This is iteration`, and neither judge prompt SHALL contain `The principal's answer or earlier feedback`

#### Scenario: task.agent's judge sees an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task.agent` whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its judge step is composed for iteration `1`
- **THEN** the judge prompt SHALL contain `The principal's answer or earlier feedback: Use the v2 API` and `do not choose ask for that question again`

#### Scenario: task-delegate.agent's judge sees an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task-delegate.agent` with a `claude_code` grant whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its judge step is composed for iteration `1`
- **THEN** the judge prompt SHALL contain `The principal's answer or earlier feedback: Use the v2 API` and `do not choose ask for that question again`
