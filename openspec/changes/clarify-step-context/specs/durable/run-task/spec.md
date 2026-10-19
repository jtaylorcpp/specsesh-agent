## MODIFIED Requirements

### Requirement: The result section shows the schema only on structured steps
`AgentScriptStepExtension` SHALL contribute a system-prompt section named `result`. When the conversation's `agentscript.step` doc has a non-null `schema`, the section text MUST be `Finish by submitting a structured result matching this JSON Schema:` followed by a newline and the schema as two-space-indented JSON. The section MUST NOT name a tool. When the schema is null or the doc is absent, the section MUST be omitted.

#### Scenario: The classify step's prompt shows its schema
- **WHEN** the `classify` step's model request is made
- **THEN** the `result` section SHALL contain `"severity"`

#### Scenario: The respond step has no result section
- **WHEN** the `respond` step's model request is made
- **THEN** there SHALL be no `result` section

#### Scenario: The result section names no tool
- **WHEN** the `classify` step's model request is made
- **THEN** the `result` section SHALL start with `Finish by submitting a structured result matching this JSON Schema:` followed by a newline
- **AND** it SHALL NOT contain `submit_result`
- **AND** the request SHALL still offer the `submit_result` tool
