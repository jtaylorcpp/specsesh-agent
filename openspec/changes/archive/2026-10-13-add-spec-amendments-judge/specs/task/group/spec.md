## ADDED Requirements

### Requirement: The group judge reads back an amendment
After the judge's run, the loop SHALL also read `amend_path` and `amend_text`. Both are strings. `amend_path` is the path of a spec delta relative to the change directory, e.g. `specs/task/queue/spec.md`. `amend_text` is that delta's full replacement text. The loop SHALL use both only when `next_action` is `amend-spec`, and SHALL ignore them for `rework` and `ask`.

#### Scenario: An amend-spec verdict yields an Amendment
- **WHEN** the judge sets `next_action` `"amend-spec"`, `amend_path` `"specs/task/queue/spec.md"` and `amend_text` `"## MODIFIED Requirements\n\n### Requirement: Empty queue\n…"`
- **THEN** the loop SHALL build the `Amendment` `{ delta: "specs/task/queue/spec.md", text: "## MODIFIED Requirements\n\n### Requirement: Empty queue\n…" }` with both values unchanged

#### Scenario: ask ignores the amendment variables
- **WHEN** the judge sets `next_action` `"ask"`, `question` `"Drop scenario X?"`, `amend_path` `"specs/task/queue/spec.md"` and a non-empty `amend_text`
- **THEN** the group SHALL end `blocked` with an escalation that has no `amendment` field

### Requirement: The group loop constrains amend_path to the change's deltas
Every judge run the group loop starts SHALL carry, beside the `next_action` choices, `amend_path` choices made of `""` followed by each spec delta of the change in `deltas` order. The choices SHALL NOT include the proposal, the design, `tasks.md` or any file that is not a spec delta.

#### Scenario: The amend_path choices list the change's deltas
- **GIVEN** a change whose deltas are `specs/task/queue/spec.md` then `specs/task/group/spec.md`
- **WHEN** the group judge is dispatched
- **THEN** its run SHALL carry `choices` `{ next_action: ["rework", "ask", "amend-spec"], amend_path: ["", "specs/task/queue/spec.md", "specs/task/group/spec.md"] }`

## MODIFIED Requirements

### Requirement: The judge contract is checked before anything runs
`startGroupLoop` SHALL check that the group script declares every seeded and read-back variable with its type. The read-back variables include `amend_path` and `amend_text`, both `string`. A missing or mistyped variable MUST refuse the start, naming it, before any loop or model request.

#### Scenario: A script without rework_task is refused
- **GIVEN** a group script that does not declare `rework_task`
- **WHEN** `startGroupLoop` is called with it
- **THEN** it SHALL reject naming `rework_task`, and no loop SHALL be created

#### Scenario: A script without amend_path is refused
- **GIVEN** a group script that declares the four verdict variables but not `amend_path`
- **WHEN** `startGroupLoop` is called with it
- **THEN** it SHALL reject naming `amend_path`, and no loop SHALL be created

### Requirement: ask and amend-spec block the group
`ask` or `amend-spec` SHALL end the group `blocked`, escalated at `level` `"group"` to `escalateTo`, asking the judge's `question` or else the check output's first line. `amend-spec` SHALL record a `spec-defect` finding and set `escalation.amendment` to `{ delta: amend_path, text: amend_text }`, unchanged and unwritten; with `amend_path` `""` or `amend_text` blank it SHALL omit it and note `amendment dropped: <variable> is empty`.

#### Scenario: The judge asks the principal
- **WHEN** the judge sets `next_action` `"ask"` and `question` `"Drop scenario X?"`
- **THEN** the group SHALL end `blocked` with an escalation to `principal`, level `"group"`, asking `"Drop scenario X?"`

#### Scenario: The escalation carries the judge's amendment
- **GIVEN** `escalateTo` `principal`
- **WHEN** the judge sets `next_action` `"amend-spec"`, `question` `"Scenario 'Empty queue' contradicts the ticked-task rule; replace the delta?"`, `amend_path` `"specs/task/queue/spec.md"` and a non-blank `amend_text`
- **THEN** the group SHALL end `blocked` with an escalation at level `"group"`, to `principal`, with that question and `amendment` `{ delta: "specs/task/queue/spec.md", text: <amend_text exactly> }`
- **AND** the round SHALL be recorded with a `spec-defect` finding and `amend-spec` feedback
- **AND** no file under the change directory SHALL have been written

#### Scenario: A blank amend_text drops the amendment
- **WHEN** the judge sets `next_action` `"amend-spec"`, `question` `"The queue delta looks wrong; how should it read?"`, `amend_path` `"specs/task/queue/spec.md"` and `amend_text` `""`
- **THEN** the loop SHALL record the note `amendment dropped: amend_text is empty`
- **AND** the group SHALL end `blocked` with an escalation at level `"group"` asking that question, with no `amendment` field, and a `spec-defect` finding

#### Scenario: An empty amend_path drops the amendment
- **WHEN** the judge sets `next_action` `"amend-spec"`, `amend_path` `""` and a non-blank `amend_text`
- **THEN** the loop SHALL record the note `amendment dropped: amend_path is empty`, and the group SHALL end `blocked` with an escalation at level `"group"` and no `amendment` field

### Requirement: An answered escalation resumes the group as a new run
`answerGroupEscalation` SHALL accept an answer only for a `blocked` group loop, from the escalation's `to`. A task block SHALL rerun that task's loop with `carried` set to the decision. A judge block SHALL rerun the check, then the judge with the decision appended to `check_output`; on `amendment-applied` to a block carrying an `amendment` it SHALL first re-read the deltas from disk, without adding to `reworks`.

#### Scenario: Answering a blocked task resumes the group
- **GIVEN** a group blocked by task `1.1`, escalated to `principal`
- **WHEN** the principal answers `"Use the v2 API"`
- **THEN** `1.1`'s loop SHALL run again with `carried` `"Use the v2 API"`, and the group SHALL continue with `1.2`

#### Scenario: An applied amendment converges the group
- **GIVEN** group `1` with converged tasks `1.1` and `1.2`, blocked by the judge with `amendment.delta` `"specs/task/queue/spec.md"`, and the principal having written the amendment's text to that delta
- **WHEN** the principal answers `{ by: "principal", decision: "amendment-applied" }` and the rerun check `pnpm test` exits `0`
- **THEN** the loop SHALL have re-read the deltas before the check, and the group SHALL end `converged` with `1.1` and `1.2` at `runs` `1` and `reworks` `0`

#### Scenario: A still-failing check after an amendment goes to the judge with the new deltas
- **GIVEN** a group blocked by the judge with an `amendment`, whose delta file now holds new text
- **WHEN** the principal answers `amendment-applied` and the rerun check exits `1`
- **THEN** the judge SHALL run with `deltas` containing the new text and `check_output` containing `amendment-applied`, and `reworks` SHALL be unchanged

#### Scenario: amendment-applied on a block without an amendment is a plain judge answer
- **GIVEN** a group blocked by the judge on `ask`, with no `amendment`
- **WHEN** the principal answers `amendment-applied`
- **THEN** the answer SHALL be accepted, the check SHALL rerun, and on failure the judge SHALL run with `amendment-applied` appended to `check_output`

### Requirement: The bundled group.agent fits the contract and acts on nothing
The package SHALL bundle `src/task/scripts/group.agent`: one reasoning subagent setting the six read-back variables (the four verdict variables, `amend_path`, `amend_text`) from a structured result, declaring every seeded variable, with no actions and no lint diagnostic. Its judge SHALL rework first, reopening the task most likely at fault while reworks remain; `ask` only for a decision no rework settles; and `amend-spec` when the spec delta itself is wrong.

#### Scenario: The bundled judge script is clean
- **WHEN** the bundled `group.agent` is analysed and scanned
- **THEN** it SHALL have no diagnostic, no unsupported construct and no action, and pass the judge contract check

#### Scenario: The bundled judge reworks first
- **WHEN** the bundled `group.agent`'s judge step is composed with `rework_count` `1`
- **THEN** its prompt SHALL contain `rework the task most likely at fault` and SHALL NOT contain `Prefer asking`

#### Scenario: The bundled judge is told how to amend a delta
- **WHEN** the bundled `group.agent`'s judge step is composed
- **THEN** its prompt SHALL contain `when the spec delta itself is wrong` and name `amend-spec`, `amend_path` and `amend_text`
