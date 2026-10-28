## MODIFIED Requirements

### Requirement: A step ends answered, cut short, or failed
`StepOutcome` SHALL be a union on `kind` with exactly three members: `{ kind: "answered", text, structured?, toolCalls? }`, where `structured` is present only when the step asked for one and `toolCalls` only when it offered tools (see "An answer records its tool calls"); `{ kind: "cut-short", text, turns, toolCalls? }`, where `turns` is the implementation's own count; and `{ kind: "failed", category, message, toolCalls? }`, where `message` is the layer's own words, verbatim.

#### Scenario: The implementation reports a step stopped at its bound
- **WHEN** the port answers `{ kind: "cut-short", text: "partial", turns: 7 }`
- **THEN** the step's outcome SHALL be that object, with `turns` 7
- **AND** the run's `kind` SHALL be `cut-short`

#### Scenario: An answer records the tools it called
- **WHEN** a step offering `shell` is answered after two calls to it
- **THEN** `toolCalls` SHALL hold two entries named `shell`, in call order, each with its `inputs`, `ok` and `outputs`

#### Scenario: A failed step keeps the tools it called
- **WHEN** a step offering `shell` is reported `failed` after one call to it
- **THEN** the step's outcome SHALL be `failed` with `toolCalls` holding that one call

### Requirement: An answer records its tool calls
A step that offered tools and whose tool path ran SHALL carry `toolCalls` on whatever outcome it ends with: one `{ name, inputs, ok, outputs, record? }` per call, in call order. `ok` SHALL be `false` for a refused, failed or interrupted call, whose `outputs` are `{}`; `record` is the host's opaque `Action`/`Evidence` record, carried through unchanged. A failure `run()` derives from an answer SHALL keep its calls; outputs SHALL be applied only from an answered step.

#### Scenario: A refused call is recorded as not ok
- **GIVEN** a step offering `shell`
- **WHEN** the host refuses a call to it
- **THEN** its `toolCalls` entry SHALL have `ok` `false` and `outputs` `{}`

#### Scenario: A cut-short step keeps its calls and sets nothing
- **GIVEN** a step whose reasoning action `read` sets `@variables.content = @outputs.content`
- **WHEN** the port reports `cut-short` with one `read` call whose outputs carry `content`
- **THEN** the step's outcome SHALL keep that call, and `content` SHALL stay unset

#### Scenario: A failure derived from an answer keeps its calls
- **GIVEN** a structured step offering `read`
- **WHEN** it is answered with one `read` call and no structured result
- **THEN** the step SHALL be failed and its outcome SHALL keep that call

### Requirement: A tool offer declares, and never executes
`ToolOffer` SHALL be `{ name, description, inputSchema, action, bound }` (`core/composition`). The core SHALL never call a tool: it offers declarations and reads back `toolCalls` only to apply outputs. A recorded call, on any outcome, naming a tool the request did not offer SHALL make the step failed, with category `unknown` and no `toolCalls`.

#### Scenario: An unoffered tool call fails the step
- **GIVEN** a step offering only `edit`
- **WHEN** it is answered with a `toolCalls` entry named `delete`
- **THEN** the step SHALL be failed, naming `delete`, and nothing SHALL be set from it

#### Scenario: An unoffered call on a failed outcome is still refused
- **GIVEN** a step offering only `edit`
- **WHEN** it is reported `failed` with a `toolCalls` entry named `delete`
- **THEN** the step SHALL be failed, naming `delete`, with no `toolCalls`
