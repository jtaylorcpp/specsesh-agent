## MODIFIED Requirements

### Requirement: A port that cannot run tools refuses a request that offers them
A port that cannot run a tool loop SHALL answer any request carrying `tools` with `{ kind: "failed", category: "invalid_request" }` and the `TOOLS_NEED_DURABLE_HOST` message, which names the durable host, a pi port given a tool host, and a claude-code port given tools and a bridge, without contacting a model. The pi and claude-code ports created without `tools` are such ports.

#### Scenario: The pi port refuses a tool request
- **GIVEN** the pi reasoning port created without `tools`, and a request with `tools`
- **WHEN** `reason` is called
- **THEN** it SHALL resolve failed with category `invalid_request`, and no model request SHALL be made
- **AND** the message SHALL contain `durable host` and `tool host`

#### Scenario: The claude-code port without tools refuses a tool request
- **GIVEN** the claude-code reasoning port created without `tools`, and a request with `tools`
- **WHEN** `reason` is called
- **THEN** it SHALL resolve failed with category `invalid_request` and a message containing `claude-code port given tools`, and the runner SHALL not have been called
