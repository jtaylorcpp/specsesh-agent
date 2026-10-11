## MODIFIED Requirements

### Requirement: The package exports two pi-durable extensions
`@specsesh/agent/durable` SHALL export `AgentScript`, an extension named `agentscript` whose only task is `AgentScriptRun`, and `AgentScriptStepExtension`, an extension named `agentscript.step` carrying exactly one section (`result`) and exactly one tool (`submit_result`). A host MUST install both into the pi-durable registry it opens the harness with; the package registers nothing on its own.

#### Scenario: A host installs both extensions
- **GIVEN** a registry from `createRegistry()`
- **WHEN** the host calls `registry.install(AgentScript)` and `registry.install(AgentScriptStepExtension)` and opens a `Harness` with that registry
- **THEN** a task of name `agentscript.run` can be created through that harness
- **AND** step conversations configured by that task can select the `agentscript.step` extension

#### Scenario: The result tool name is a stable export
- **WHEN** a caller reads `RESULT_TOOL` from `@specsesh/agent/durable`
- **THEN** it SHALL equal `"submit_result"`, the name the step's tool is registered under

### Requirement: The agentscript.step doc holds each step's schema and accepted result
`@specsesh/agent/durable` SHALL export `AgentScriptStep`, defined with `defineDoc` as kind `agentscript.step`, version `1`, scope `conversation`, history `latest`, fork `initial`, and initial value `{ schema: null, result: null }`. `schema` MUST be the step's JSON Schema or `null` for a text-only step; `result` MUST be `null` until `submit_result` accepts a result, and then the accepted object.

#### Scenario: A fresh step conversation starts empty and gets its schema at dispatch
- **WHEN** dispatch configures a structured step
- **THEN** the doc SHALL read `{ schema: <the request's outputSchema>, result: null }` before the model is called

#### Scenario: A text-only step's doc has no schema
- **WHEN** dispatch configures a text-only step
- **THEN** the doc SHALL read `{ schema: null, result: null }`

### Requirement: checkResult refuses a result with no schema or no object
`@specsesh/agent/durable` SHALL export `checkResult(schema, value): string | undefined`, returning `undefined` when the value is acceptable and otherwise one message for the model. When `schema` is `null` it MUST return `This step takes no structured result; answer in text instead.`; when `value` is `null`, not an object, or an array it MUST return `The result must be an object.`

#### Scenario: A non-object result is refused
- **WHEN** `checkResult` is called on a schema with `null`, `"high"`, `3` or `["high"]`
- **THEN** it SHALL return `The result must be an object.`

#### Scenario: A text-only step refuses any result
- **WHEN** `checkResult(null, { a: 1 })` is called
- **THEN** the message SHALL contain `takes no structured result`
