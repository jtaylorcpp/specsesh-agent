## MODIFIED Requirements

### Requirement: The script declares the variables the loop reads back
A task script MUST declare, with these types: `met` boolean, `unmet` string, `next_action` string, `question` string, `amend_path` string, `amend_text` string. After each iteration the loop SHALL read them from the run's final variables. `next_action` SHALL be read as one of `"retry"`, `"amend-spec"` or `"ask"`. Both bundled judge prompts SHALL contain `set amend_path to the delta that is wrong`, `the whole new text of that file, not a patch` and `leave both empty`.

#### Scenario: A met verdict is read back
- **WHEN** an iteration's run ends with `met` `True`
- **THEN** the loop SHALL treat that iteration's verdict as met

#### Scenario: A script missing amend_path is refused
- **GIVEN** a script declaring every contract variable except `amend_path`
- **WHEN** `startTaskLoop` is called with it
- **THEN** it SHALL reject naming `amend_path` and `string`, no loop SHALL be created, and no model request SHALL be made

#### Scenario: The judge prompt asks for the whole file
- **WHEN** the judge step of `task.agent` or `task-delegate.agent` is composed
- **THEN** its prompt SHALL contain `set amend_path to the delta that is wrong`, `the whole new text of that file, not a patch` and `leave both empty`

### Requirement: Judge maps ask and amend-spec to a blocked loop
When `met` is false and `next_action` is `"ask"`, the loop SHALL end `"blocked"` with `Escalation { level: "task", to: escalateTo, reason: unmet, question }` and no `amendment`. When it is `"amend-spec"`, it SHALL end the same way, record a `"spec-defect"` `Finding`, and set `amendment` to `{ delta: amend_path, text: amend_text }`, unless `amend_path` is `""` or `amend_text` is only whitespace; then it SHALL omit `amendment` and note `amendment dropped: <variable> is empty`.

#### Scenario: An amend-spec verdict blocks with a spec defect
- **WHEN** an iteration ends with `next_action` `"amend-spec"`, `question` `"The spec says run throws UndeclaredVariableError; the lint refuses first. Amend?"`, `amend_path` `"specs/durable/host/spec.md"` and a non-empty `amend_text`
- **THEN** the loop SHALL end `"blocked"`, its escalation's `question` SHALL be that text, `to` SHALL be `"principal"`, and a `"spec-defect"` finding SHALL be recorded
- **AND** the escalation's `amendment` SHALL be `{ delta: "specs/durable/host/spec.md", text: <amend_text> }`

#### Scenario: An empty amend_text drops the amendment
- **WHEN** an iteration ends with `next_action` `"amend-spec"`, `amend_path` `"specs/durable/host/spec.md"` and `amend_text` `""`
- **THEN** the loop SHALL end `"blocked"` with a `"spec-defect"` finding and an escalation with no `amendment`
- **AND** the notes from `waitForTaskLoopResult` SHALL contain `amendment dropped: amend_text is empty`

### Requirement: The loop constrains next_action to its contract values
Every child run the task loop starts SHALL carry `choices: { next_action: ["retry", "amend-spec", "ask"], amend_path }`, `amend_path` being `""` then `specs/<capability path>/spec.md` for each delta in the order of `deltas`, so the judge step's result schema lists them and a value outside them is refused. A script whose `next_action` or `amend_path` default is not among its values MUST be refused at start, naming the variable and the default, before any loop exists.

#### Scenario: The judge step's schema lists the three values
- **WHEN** the bundled `task.agent`'s judge step is dispatched
- **THEN** its `submit_result` parameters SHALL give `next_action` `enum: ["retry", "amend-spec", "ask"]`

#### Scenario: A default outside the values is refused
- **GIVEN** a task script declaring `next_action: mutable string = "proceed"`
- **WHEN** `startTaskLoop` is called with it
- **THEN** it SHALL reject naming `next_action` and `"proceed"`, and no loop SHALL be created

#### Scenario: The judge step's schema lists the change's deltas
- **GIVEN** a change with deltas for `durable/cli` and `durable/host`
- **WHEN** the bundled `task.agent`'s judge step is dispatched
- **THEN** its `submit_result` parameters SHALL give `amend_path` `enum: ["", "specs/durable/cli/spec.md", "specs/durable/host/spec.md"]`

### Requirement: An answered escalation resumes the loop as a new run
`answerEscalation` SHALL reject as invalid input an `EscalationAnswer` for a loop not `"blocked"`, one whose `by` differs from the escalation's `to`, or an `"amendment-applied"` one that `openspec/loops` refuses. An accepted answer SHALL start a new run of the loop, keeping earlier iterations, with `carried` `answer.decision`, or for `"amendment-applied"`: `The principal applied your amendment to <delta>. That delta now reads:`, a blank line, then the amendment's `text`.

#### Scenario: The wrong recipient is rejected
- **GIVEN** a blocked loop whose escalation has `to` `"principal"`
- **WHEN** `answerEscalation` is called with `by` `"agent"`
- **THEN** it SHALL reject, and the loop SHALL stay blocked

#### Scenario: A principal's answer resumes the loop
- **GIVEN** the same blocked loop after 2 iterations
- **WHEN** the principal answers with `decision` `"Amend the spec; keep the code"`
- **THEN** a new run SHALL start whose first iteration is seeded with `carried` `"Amend the spec; keep the code"`, and the 2 earlier iterations SHALL remain recorded

#### Scenario: An applied amendment is carried
- **GIVEN** a loop blocked after 2 iterations whose escalation has `amendment.delta` `"specs/durable/host/spec.md"`
- **WHEN** the principal answers with `decision` `"amendment-applied"`
- **THEN** a new run SHALL start whose first iteration's `carried` is `The principal applied your amendment to specs/durable/host/spec.md. That delta now reads:`, a blank line, then `amendment.text`
- **AND** the 2 earlier iterations SHALL remain recorded
