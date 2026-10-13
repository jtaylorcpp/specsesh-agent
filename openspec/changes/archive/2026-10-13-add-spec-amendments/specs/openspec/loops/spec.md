## MODIFIED Requirements

### Requirement: An escalation names who must decide and what
The model SHALL define `Escalation` as `{ level: "task" | "group" | "change", to: "principal" | "agent", reason: string, question: string, amendment?: Amendment }` and `Amendment` as `{ delta: string, text: string }`, where `delta` is `specs/<capability>/spec.md` relative to the change and `text` is that file's full new text. Only an escalation raised by `"amend-spec"` feedback MAY carry `amendment`. A `"blocked"` outcome's escalation MUST carry a question its recipient can answer.

#### Scenario: A task loop escalates
- **WHEN** a task loop ends `"blocked"` on an `"ask"` feedback
- **THEN** its `escalation.level` SHALL be `"task"`
- **AND** the escalation SHALL have no `amendment`

#### Scenario: An escalation can go to an agent
- **GIVEN** a `"test-defect"` finding a reviewing agent can settle
- **WHEN** the loop escalates it
- **THEN** `escalation.to` MAY be `"agent"`, and the loop SHALL still end `"blocked"` until it is answered

### Requirement: An answered escalation resumes the loop
The model SHALL define `EscalationAnswer` as `{ escalation: Escalation, by: "principal" | "agent", decision: string, feedback: Feedback[] }`. `by` MUST equal `escalation.to`. The reserved decision `"amendment-applied"` says the principal applied `escalation.amendment`; it SHALL be rejected as invalid input unless that is present and `by` is `"principal"`. A blocked loop SHALL resume only as a new run of the same loop whose `LoopInput.carried` includes the answer's `feedback`.

#### Scenario: A blocked task loop resumes with the answer
- **GIVEN** a task loop that ended `"blocked"` with `escalation.to` `"principal"`
- **WHEN** the principal answers with a decision and `"retry"` feedback
- **THEN** the task loop SHALL run again with that feedback in `carried`, and its earlier iterations SHALL stay recorded

#### Scenario: Only the named recipient answers
- **GIVEN** an escalation with `to` `"principal"`
- **WHEN** an `EscalationAnswer` arrives with `by` `"agent"`
- **THEN** it SHALL be rejected as invalid input

#### Scenario: amendment-applied needs an amendment
- **GIVEN** a blocked escalation with `to` `"principal"` and no `amendment`
- **WHEN** the principal answers with `decision` `"amendment-applied"`
- **THEN** the answer SHALL be rejected as invalid input, and the loop SHALL stay blocked

