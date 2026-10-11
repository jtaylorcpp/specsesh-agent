## ADDED Requirements

### Requirement: A tool offer declares, and never executes
`ToolOffer` SHALL be `{ name, description, inputSchema, action, bound }` (`core/composition`). The core SHALL never call a tool: it offers declarations and reads back `toolCalls` only to apply outputs. A recorded call naming a tool the request did not offer SHALL make the step failed, with category `unknown`.

#### Scenario: An unoffered tool call fails the step
- **GIVEN** a step offering only `edit`
- **WHEN** it is answered with a `toolCalls` entry named `delete`
- **THEN** the step SHALL be failed, naming `delete`, and nothing SHALL be set from it

### Requirement: An answer records its tool calls
An answered step that offered tools SHALL carry `toolCalls`: one `{ name, inputs, ok, outputs, record? }` per call, in call order. `ok` SHALL be `false` for a refused, failed or interrupted call, whose `outputs` are `{}`; `record` is the host's opaque `Action`/`Evidence` record, carried through unchanged.

#### Scenario: A refused call is recorded as not ok
- **GIVEN** a step offering `shell`
- **WHEN** the host refuses a call to it
- **THEN** its `toolCalls` entry SHALL have `ok` `false` and `outputs` `{}`

### Requirement: A port that cannot run tools refuses a request that offers them
A port implementation that cannot run a tool loop SHALL answer any request carrying `tools` with `{ kind: "failed", category: "invalid_request" }` and a message saying tools need the durable host, without contacting a model. The pi reasoning port and the claude-code port are such ports.

#### Scenario: The pi port refuses a tool request
- **GIVEN** the pi reasoning port and a request with `tools`
- **WHEN** `reason` is called
- **THEN** it SHALL resolve failed with category `invalid_request`, and no model request SHALL be made

## MODIFIED Requirements

### Requirement: A request has exactly three fields
Each dispatched `ReasoningRequest` SHALL hold `systemInstructions` (string), `prompt` (string), `outputSchema` (a JSON Schema object) only for a step that writes variables from its result, and `tools` (a non-empty `ToolOffer[]`) only for a step with reasoning actions. No other key SHALL be present. The type SHALL hold no executor or turn bound: `tools` are declarations, and the package SHALL execute no tool and count no rounds.

#### Scenario: Only the three fields cross the boundary
- **WHEN** a plain step and a structured step are dispatched
- **THEN** every key of every request SHALL be one of `systemInstructions`, `prompt`, `outputSchema` or `tools`
- **AND** the plain step's request SHALL have no `outputSchema`
- **AND** neither request SHALL have a `tools` key, because neither step has reasoning actions

#### Scenario: A step with reasoning actions offers tools
- **GIVEN** the default task script's `act` subagent
- **WHEN** its request is dispatched
- **THEN** it SHALL carry `tools` naming `read`, `edit` and `shell`, in that order, and no `outputSchema`

### Requirement: A step ends answered, cut short, or failed
`StepOutcome` SHALL be a union on `kind` with exactly three members: `{ kind: "answered", text, structured?, toolCalls? }`, where `structured` is present only when the step asked for one and `toolCalls` only when it offered tools (see "An answer records its tool calls"); `{ kind: "cut-short", text, turns }`, where `turns` is the implementation's own count; and `{ kind: "failed", category, message }`, where `message` is the layer's own words, verbatim.

#### Scenario: The implementation reports a step stopped at its bound
- **WHEN** the port answers `{ kind: "cut-short", text: "partial", turns: 7 }`
- **THEN** the step's outcome SHALL be that object, with `turns` 7
- **AND** the run's `kind` SHALL be `cut-short`

#### Scenario: An answer records the tools it called
- **WHEN** a step offering `shell` is answered after two calls to it
- **THEN** `toolCalls` SHALL hold two entries named `shell`, in call order, each with its `inputs`, `ok` and `outputs`

### Requirement: A run's kind comes from its last step
A run's `kind` SHALL be `completed` when every dispatched step answered and every action call succeeded, or nothing was dispatched. Otherwise it SHALL be the last step's `cut-short` or `failed`, or `failed` for a failed action call, because either ends the run. The interpreter SHALL impose no bound of its own and pass none to the port.

#### Scenario: A failed step ends the run
- **GIVEN** two entries
- **WHEN** the first step fails
- **THEN** the run's `kind` SHALL be `failed` and the second SHALL NOT be dispatched

#### Scenario: The interpreter imposes no bound of its own
- **WHEN** a run dispatches steps
- **THEN** no request SHALL carry a turn or round limit, and the runner SHALL keep no count of its own

#### Scenario: A failed action call ends the run
- **GIVEN** two entries, the first a deterministic subagent whose call fails
- **WHEN** the run proceeds
- **THEN** the run's `kind` SHALL be `failed` and the second entry SHALL NOT be reached
