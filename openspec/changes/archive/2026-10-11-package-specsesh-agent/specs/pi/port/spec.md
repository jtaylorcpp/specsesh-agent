## MODIFIED Requirements

### Requirement: The pi adapter exports its port, mapping and model helpers
`@specsesh/agent/pi` SHALL export `createPiReasoningPort`, `forceTool`, `toOutcome`, `RESULT_TOOL`, `categoryFromStatus`, `DEFAULT_PROVIDER`, `DEFAULT_MODEL` and `resolveModel`, and nothing from the claude-code layer, which has its own entry (`pi/claude-code`). `RESULT_TOOL` MUST equal `"submit_result"`.

#### Scenario: The result tool name is stable
- **WHEN** a caller reads `RESULT_TOOL` from `@specsesh/agent/pi`
- **THEN** it SHALL equal `"submit_result"`

#### Scenario: The pi entry carries no claude-code exports
- **WHEN** a caller imports `@specsesh/agent/pi`
- **THEN** `createClaudeCodeReasoningPort` and `claudeCodeProvider` SHALL NOT be among its exports
