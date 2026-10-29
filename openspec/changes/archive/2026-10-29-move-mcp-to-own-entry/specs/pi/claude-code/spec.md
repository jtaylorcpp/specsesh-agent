## MODIFIED Requirements

### Requirement: mcpBridge serves a step's tools to claude over loopback HTTP
`mcpBridge()` from `@specsesh/agent/mcp` SHALL return a `ToolBridgeFactory` whose bridge serves Streamable HTTP MCP on `127.0.0.1` only, refusing a request without its random bearer token with `401`. Its `mcpConfig` SHALL be a mode-`0600` file naming the server `agentscript`; `allowedTools` SHALL be `mcp__agentscript__<name>` per tool. `tools/call` SHALL answer through the handler, `!ok` or a throw as `isError`. `close` SHALL stop the server and remove the file.

#### Scenario: The bridge lists and calls its tools
- **GIVEN** a bridge for one tool `echo` whose handler answers `{ ok: true, text: "hi" }`
- **WHEN** an MCP client connects with the URL and header from its `mcpConfig` file, lists tools and calls `echo`
- **THEN** the list SHALL hold `echo` with its input schema, and the call SHALL answer text `hi`

#### Scenario: A request without the token is refused
- **WHEN** a POST reaches the bridge's URL without the `Authorization` header
- **THEN** it SHALL be answered `401` and the handler SHALL not be called

#### Scenario: A failing handler is an error result
- **GIVEN** a bridge whose handler throws `nope`
- **WHEN** a client calls the tool
- **THEN** the result SHALL have `isError: true` and text `nope`

#### Scenario: The config file is private and removed on close
- **WHEN** a bridge is started and then closed
- **THEN** its `mcpConfig` file SHALL have had mode `0600` while open, its `allowedTools` SHALL be `["mcp__agentscript__echo"]`, and the file SHALL not exist after `close`

