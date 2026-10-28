## MODIFIED Requirements

### Requirement: A request has exactly three fields
Each dispatched `ReasoningRequest` SHALL hold `systemInstructions` (string), `prompt` (string), `outputSchema` (a JSON Schema object) only for a step that writes variables from its result, and `tools` (a non-empty `ToolOffer[]`) only for a step with reasoning actions. No other key SHALL be present. The type SHALL hold no executor or turn bound: `tools` are declarations, and the interpreter SHALL execute no tool and count no rounds.

#### Scenario: Only the three fields cross the boundary
- **WHEN** a plain step and a structured step are dispatched
- **THEN** every key of every request SHALL be one of `systemInstructions`, `prompt`, `outputSchema` or `tools`
- **AND** the plain step's request SHALL have no `outputSchema`
- **AND** neither request SHALL have a `tools` key, because neither step has reasoning actions

#### Scenario: A step with reasoning actions offers tools
- **GIVEN** the default task script's `act` subagent
- **WHEN** its request is dispatched
- **THEN** it SHALL carry `tools` naming `read`, `edit` and `shell`, in that order, and no `outputSchema`

### Requirement: A port that cannot run tools refuses a request that offers them
A port that cannot run a tool loop SHALL answer any request carrying `tools` with `{ kind: "failed", category: "invalid_request" }` and the `TOOLS_NEED_DURABLE_HOST` message, which names the durable host and a pi port given a tool host, without contacting a model. The claude-code port, and the pi port created without `tools`, are such ports.

#### Scenario: The pi port refuses a tool request
- **GIVEN** the pi reasoning port created without `tools`, and a request with `tools`
- **WHEN** `reason` is called
- **THEN** it SHALL resolve failed with category `invalid_request`, and no model request SHALL be made
- **AND** the message SHALL contain `durable host` and `tool host`
