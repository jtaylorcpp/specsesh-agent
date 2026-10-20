## ADDED Requirements

### Requirement: The bundled task scripts' system block is role-neutral
The `system` instructions of `task.agent` and `task-delegate.agent` SHALL start with `You are one step of a task loop that implements one task of an OpenSpec change` and SHALL contain `Each step's prompt says its role.` and `A step without tools decides only from the text it is given.` They MUST NOT contain `real workspace`. They SHALL keep the contract rules: the spec deltas are the contract, never tick boxes, never edit the spec, and say so when the spec looks wrong.

#### Scenario: The system block names no workspace
- **WHEN** a model step of either bundled task script is composed
- **THEN** its `instructions` section SHALL start with `You are one step of a task loop that implements one task of an OpenSpec change` and contain `Each step's prompt says its role.` and `A step without tools decides only from the text it is given.`
- **AND** it SHALL NOT contain `real workspace` or `You implement one task`

#### Scenario: The system block keeps the contract rules
- **WHEN** the `system` instructions of either bundled task script are read
- **THEN** they SHALL contain `The spec deltas are the contract`, `never tick boxes`, `never edit the spec` and `If the spec itself looks wrong, say so`

### Requirement: Each bundled task step's prompt says its role
In `task.agent` and `task-delegate.agent`, the prompt of every step that makes a model request SHALL start with `You are the <step> step`. The prompts of the tool-less steps (orient and judge in both, and retire in `task-delegate.agent`) SHALL contain `You have no tools: decide only from the text below.` `task.agent`'s `act` prompt SHALL contain `you act in the real workspace` and SHALL NOT contain that sentence. Retire's role line SHALL sit inside its `delete_granted` branch.

#### Scenario: task.agent's tool-less steps say their role
- **WHEN** an iteration of the bundled `task.agent` composes its orient and judge steps
- **THEN** the orient prompt SHALL start with `You are the orient step` and the judge prompt with `You are the judge step`
- **AND** each SHALL contain `You have no tools: decide only from the text below.`

#### Scenario: task-delegate.agent's tool-less steps say their role
- **GIVEN** a harness with `deleteFiles` `true` and a `claude_code` grant on a fake `claude`
- **WHEN** an iteration of the bundled `task-delegate.agent` composes its orient, retire and judge steps
- **THEN** their prompts SHALL start with `You are the orient step`, `You are the retire step` and `You are the judge step`
- **AND** each SHALL contain `You have no tools: decide only from the text below.`

#### Scenario: task.agent's act step acts in the real workspace
- **WHEN** an iteration of the bundled `task.agent` dispatches its act step
- **THEN** the act prompt SHALL start with `You are the act step`, contain `you act in the real workspace` and `Carry out this plan`
- **AND** it SHALL NOT contain `You have no tools`

#### Scenario: Without the delete grant, retire makes no model request
- **GIVEN** a harness without `deleteFiles` and a `claude_code` grant on a fake `claude`
- **WHEN** an iteration of the bundled `task-delegate.agent` runs
- **THEN** no model request's prompt SHALL start with `You are the retire step`

### Requirement: The bundled judges see the plan as another step's instructions
`task-delegate.agent`'s judge prompt SHALL show `plan` after `The instructions the delegate was given (for the delegate, not for you): `, and `task.agent`'s after `The plan the act step followed (for the act step, not for you): `. Neither judge prompt SHALL have a line starting `Plan:`.

#### Scenario: task-delegate.agent's judge sees the delegate's instructions
- **GIVEN** a run of the bundled `task-delegate.agent` with a `claude_code` grant whose orient step answers the plan `Edit src/a.ts`
- **WHEN** its judge step is composed
- **THEN** the judge prompt SHALL contain `The instructions the delegate was given (for the delegate, not for you): Edit src/a.ts`
- **AND** no line of it SHALL start with `Plan:`

#### Scenario: task.agent's judge sees the act step's plan
- **GIVEN** a run of the bundled `task.agent` whose orient step answers the plan `Edit src/a.ts`
- **WHEN** its judge step is composed
- **THEN** the judge prompt SHALL contain `The plan the act step followed (for the act step, not for you): Edit src/a.ts`
- **AND** no line of it SHALL start with `Plan:`

### Requirement: The bundled judges say what next_action is when the task is met
The loop ignores `next_action` on a met verdict, and no value means done. Each bundled judge prompt (`task.agent`, `task-delegate.agent`) SHALL contain the line `When the task is met, next_action is ignored: answer retry.` directly before the line `Answer next_action with exactly one word: retry, amend-spec or ask. Put every explanation in unmet, never in next_action.`

#### Scenario: The judges say next_action is ignored when the task is met
- **GIVEN** a run of the bundled `task.agent`, and a run of the bundled `task-delegate.agent` with a `claude_code` grant
- **WHEN** each judge step is composed
- **THEN** each judge prompt SHALL contain the line `When the task is met, next_action is ignored: answer retry.`
- **AND** the next line SHALL be `Answer next_action with exactly one word: retry, amend-spec or ask. Put every explanation in unmet, never in next_action.`

## MODIFIED Requirements

### Requirement: The bundled task scripts show carried feedback whenever it is non-empty
The orient and judge prompts of `task.agent` and `task-delegate.agent` SHALL contain the `carried` text whenever it is non-empty, including on the first iteration of a run resumed by an answer. The judge SHALL label it `Feedback carried in (from an earlier iteration or the principal's answer): `, never as the principal's alone, and when it answers a question SHALL not choose `ask` for it again; checks still decide done. When `carried` is empty neither prompt SHALL contain it.

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
- **THEN** neither orient prompt SHALL contain `Carried in` or `This is iteration`, and neither judge prompt SHALL contain `Feedback carried in`

#### Scenario: task.agent's judge sees an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task.agent` whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its judge step is composed for iteration `1`
- **THEN** the judge prompt SHALL contain `Feedback carried in (from an earlier iteration or the principal's answer): Use the v2 API` and `do not choose ask for that question again`
- **AND** it SHALL NOT contain `The principal's answer or earlier feedback`

#### Scenario: task-delegate.agent's judge sees an answer on a resumed run's first iteration
- **GIVEN** a run of the bundled `task-delegate.agent` with a `claude_code` grant whose first iteration is seeded with `carried` `"Use the v2 API"`
- **WHEN** its judge step is composed for iteration `1`
- **THEN** the judge prompt SHALL contain `Feedback carried in (from an earlier iteration or the principal's answer): Use the v2 API` and `do not choose ask for that question again`
- **AND** it SHALL NOT contain `The principal's answer or earlier feedback`
