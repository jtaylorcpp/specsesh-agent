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
