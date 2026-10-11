## ADDED Requirements

### Requirement: Run inputs are evaluated when the run is reached
Each `with <input> = <expression>` of a `run` SHALL be evaluated against the working variables at the moment the walk reaches that `run`, so it reads every earlier `set`. A value whose type is not the input's declared type SHALL stop the run as a failed action naming the input, before the host is called.

#### Scenario: An input reads an earlier set
- **GIVEN** `set @variables.task_id = "2.4"` followed by `run @actions.run_checks` with `with task_id = @variables.task_id`
- **WHEN** the call is produced
- **THEN** its `inputs` SHALL be `{ task_id: "2.4" }`

#### Scenario: A wrongly typed input never reaches the host
- **GIVEN** an input declared `number`, given `with count = @variables.label` where `label` is a string
- **WHEN** the walk reaches the `run`
- **THEN** the run SHALL stop failed, naming `count`, and no call SHALL reach the host

### Requirement: Run outputs are applied together
When an action call succeeds, each `set @variables.<v> = @outputs.<field>` beneath its `run` SHALL take `outputs[field]`, all staged first and then applied together; statements after the `run` read the new values. An output field that is missing, or not a string, number or boolean, SHALL fail the action and set nothing from it.

#### Scenario: Two outputs land together
- **GIVEN** `set @variables.checks_passed = @outputs.passed` and `set @variables.check_output = @outputs.output` under a `run`
- **WHEN** the host answers `{ ok: true, outputs: { passed: true, output: "12 passed" } }`
- **THEN** both variables SHALL be set

#### Scenario: A missing output field sets nothing
- **WHEN** the host answers `{ ok: true, outputs: { passed: true } }` for the same `run`
- **THEN** the action SHALL fail, naming `output`, and `checks_passed` SHALL keep its earlier value

### Requirement: A reasoning action becomes a tool offer
Each reasoning-action entry SHALL become one `ToolOffer` on the step's request, in source order: `name` the entry's key, `description` the action's description, `action` the target's tool name, `inputSchema` a JSON Schema object of the model-filled inputs (each typed as declared, all required, `additionalProperties: false`), and `bound` the bound inputs, evaluated when the step is composed.

#### Scenario: Model-filled and bound inputs are split
- **GIVEN** `shell: @actions.run_command` with `with command = ...`, and `note: @actions.edit_file` with `with path = "NOTES.md"` and `with content = ...`
- **WHEN** the step is composed
- **THEN** `tools` SHALL hold `shell` with `inputSchema.properties` `{ command: { type: "string" } }` and `bound` `{}`
- **AND** `note` with `inputSchema.required` `["content"]` and `bound` `{ path: "NOTES.md" }`

### Requirement: A reasoning action's set takes the last call's outputs
After a step answers, each `set … = @outputs.<field>` under a reasoning-action entry SHALL take the field from the outputs of the last recorded call to that entry's tool, staged and applied together with the structured result. A tool never called SHALL set nothing and is not a failure. A called tool whose outputs lack the field SHALL make the step failed, setting nothing.

#### Scenario: The last call wins
- **GIVEN** an entry `shell` with `set @variables.last_exit = @outputs.exit_code`
- **WHEN** the model calls `shell` twice, with outputs `exit_code` `1` then `0`
- **THEN** `last_exit` SHALL be `0`

#### Scenario: A tool never called sets nothing
- **WHEN** the step answers without calling `shell`
- **THEN** `last_exit` SHALL keep its value and the step SHALL be answered, not failed

## MODIFIED Requirements

### Requirement: Logic lines are decided by the program, never the model
The interpreter SHALL evaluate logic lines (`if` / `else`, `set @variables.x = <expression>`) itself, deterministically, while composing the step, and SHALL decide every reached `run` statement the same way. Composition SHALL take no port, so no logic line or `run` can cause a request; a reached `run` yields an action call to the host instead (`core/step-machine`).

#### Scenario: Logic never consults the model
- **GIVEN** a document whose only subagent is `if @variables.name == "World":` holding `set @variables.excited = True`
- **WHEN** it is run with a recording port
- **THEN** the port SHALL receive zero requests
- **AND** the result SHALL be `completed` with `variables.excited` `true`

#### Scenario: A boolean literal in a comparison is evaluated as a value
- **GIVEN** a logic-only subagent setting `stage` to `"blocked"` when `@variables.approved == False`, else `"specs"`
- **WHEN** it runs with `approved` false, and again with `variables: { approved: true }`
- **THEN** `stage` SHALL be `"blocked"` then `"specs"`
- **AND** neither run SHALL dispatch a request

#### Scenario: A run statement makes no request
- **GIVEN** a deterministic subagent holding only `run @actions.run_checks` with its `with` and `set` clauses
- **WHEN** it is run with a recording port and a host that answers the call
- **THEN** the port SHALL receive zero requests
- **AND** exactly one action call SHALL reach the host

### Requirement: Only the structured result writes a variable from the model
When a step with pending assignments answers, variables SHALL be set only from the outcome's `structured` object, never from its text. Values SHALL be taken as given, with no coercion to the declared type. Extra fields SHALL be ignored, and a step with no pending assignments SHALL ignore any `structured` it receives. Action outputs SHALL come from the host's results, never from the model's text or arguments.

#### Scenario: A structured update applies only that result
- **GIVEN** `set @variables.verdict = @outputs.verdict`
- **WHEN** the port answers `{ kind: "answered", text: "verdict: rejected", structured: { verdict: "approved" } }`
- **THEN** `variables.verdict` SHALL be `"approved"`

#### Scenario: Prose is not parsed for state
- **GIVEN** `set @variables.verdict = @outputs.verdict`
- **WHEN** the port answers text `{"verdict":"approved"}` with no `structured`
- **THEN** `verdict` SHALL NOT be set from that text

#### Scenario: A tool call's arguments are not its outputs
- **GIVEN** a reasoning-action entry `edit: @actions.edit_file` with `set @variables.edited = @outputs.ok`
- **WHEN** the step answers with a tool call whose inputs include `ok: true` and whose host outputs are `{ ok: false }`
- **THEN** `variables.edited` SHALL be `false`
