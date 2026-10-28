## MODIFIED Requirements

### Requirement: Each turn is one headless claude -p invocation with a fixed argv
`claudeArgs({ system, model, schema?, maxTurns?, tools? })` without `tools` SHALL return, in order: `-p`, `--safe-mode`, `--model`, `<model>`, `--tools`, `""`, `--no-session-persistence`, `--output-format`, `json`, `--system-prompt`, `<system with the no-workspace note>`; then `--json-schema`, `<JSON.stringify(schema)>` when a schema is given; then `--max-turns`, `<String(maxTurns)>` when given. The prompt MUST NOT be in argv: it goes on stdin.

#### Scenario: Headless, safe mode, no tools, no saved session
- **WHEN** `claudeArgs({ system: "s", model: "m" })` is called
- **THEN** it SHALL return exactly `["-p", "--safe-mode", "--model", "m", "--tools", "", "--no-session-persistence", "--output-format", "json", "--system-prompt", <"s", "\n\n" and the no-workspace note>]`

#### Scenario: A schema and a turn bound are appended in order
- **WHEN** it is called with `schema: { type: "object" }` and `maxTurns: 3`
- **THEN** the argv SHALL end with `--json-schema`, `{"type":"object"}`, `--max-turns`, `3`

### Requirement: --bare is never passed and --safe-mode always is
The argv MUST NOT contain `--bare`, which forces API-key authentication. Without `tools` it MUST contain `--safe-mode`, which stops the user's CLAUDE.md, skills, plugins, hooks and MCP servers loading into every step. With `tools` it MUST instead contain `--setting-sources ""`, `--disable-slash-commands` and `--strict-mcp-config`, because `--safe-mode` also turns off the step's own MCP server.

#### Scenario: Never bare
- **WHEN** argv is built without `tools` for any request, structured or not
- **THEN** it SHALL NOT contain `--bare` and SHALL contain `--safe-mode`

#### Scenario: A tool step is isolated without safe mode
- **WHEN** argv is built with `tools`
- **THEN** it SHALL NOT contain `--bare` or `--safe-mode`
- **AND** it SHALL contain `--setting-sources` followed by `""`, `--disable-slash-commands` and `--strict-mcp-config`

## ADDED Requirements

### Requirement: A tool step names one MCP server and allows only its tools
With `tools: { mcpConfig, allowedTools }`, `claudeArgs` SHALL put, in place of `--safe-mode`: `--setting-sources`, `""`, `--disable-slash-commands`, `--strict-mcp-config`, `--mcp-config`, `<mcpConfig>`, `--allowedTools`, `<allowedTools joined with ",">`, `--permission-mode`, `dontAsk`. Every other argument SHALL be as without `tools`, `--tools ""` included.

#### Scenario: The tool flags replace safe mode in place
- **WHEN** `claudeArgs({ system: "s", model: "m", tools: { mcpConfig: "/x/mcp.json", allowedTools: ["mcp__agentscript__a", "mcp__agentscript__b"] } })` is called
- **THEN** it SHALL return `-p`, then `--setting-sources`, `""`, `--disable-slash-commands`, `--strict-mcp-config`, `--mcp-config`, `/x/mcp.json`, `--allowedTools`, `mcp__agentscript__a,mcp__agentscript__b`, `--permission-mode`, `dontAsk`, then the same arguments that follow `--safe-mode` without `tools`

### Requirement: The port runs offered tools through a bridge when given a tool host
`createClaudeCodeReasoningPort` SHALL take `tools?: PiToolHost` and `bridge?: ToolBridgeFactory`; `tools` without `bridge` SHALL throw a `TypeError` naming `mcpBridge`. For a request with `tools`, it SHALL start the bridge with the offers, run one `claude -p` with the bridge's `tools` and `--max-turns` `maxTurns ?? 16`, and close the bridge on every path. Without `tools`, such a request is refused as before.

#### Scenario: tools need a bridge
- **WHEN** `createClaudeCodeReasoningPort({ tools: host })` is called without `bridge`
- **THEN** it SHALL throw a `TypeError` whose message contains `mcpBridge`

#### Scenario: A tool step passes the bridge's server and a turn bound
- **GIVEN** a port with a tool host and a fake bridge answering `mcpConfig` `/b/mcp.json` and `allowedTools` `["mcp__agentscript__lookup"]`
- **WHEN** a request offering `lookup` is reasoned
- **THEN** the runner's argv SHALL contain `--mcp-config`, `/b/mcp.json`, `--allowedTools`, `mcp__agentscript__lookup` and `--max-turns`, `16`, and no `--safe-mode`
- **AND** the bridge SHALL have been closed after the runner resolved

#### Scenario: The bridge is closed when the step fails
- **GIVEN** a port with a tool host, a fake bridge and a runner reporting `{ is_error: true, result: "boom" }`
- **WHEN** a request offering a tool is reasoned
- **THEN** the step SHALL fail and the bridge SHALL have been closed

#### Scenario: A bridge that will not start fails the step
- **GIVEN** a bridge factory that rejects with `no port`
- **WHEN** a request offering a tool is reasoned
- **THEN** the step SHALL fail `unknown` with a message containing `could not start the tool bridge: no port`, and the runner SHALL not have been called

#### Scenario: An unservable tool name is refused before spawning
- **WHEN** a request offering a tool named `has space` is reasoned by a port with a tool host and a bridge
- **THEN** the step SHALL fail `invalid_request` with a message naming `has space`, and neither the bridge nor the runner SHALL have been called

### Requirement: Calls through the bridge are checked, run on the host and recorded
The bridge handler SHALL refuse an unoffered name unrecorded, and refuse arguments failing `checkToolArguments` with `ok: false`, recorded with `outputs: {}`. Otherwise it SHALL call the host with `{ name, tool: offer.action, inputs: { ...args, ...offer.bound } }`, a throw being `ok: false`, and answer `JSON.stringify(outputs)` or the message. An answered step SHALL carry every recorded call in arrival order as `toolCalls`.

#### Scenario: A call runs on the host with bound inputs winning
- **GIVEN** an offer `lookup` for action `orders/lookup` with bound `{ region: "eu" }`, and a runner that calls the handler with `lookup` and `{ id: "7", region: "us" }` before answering `done`
- **WHEN** the request is reasoned
- **THEN** the host SHALL be called with `{ name: "lookup", tool: "orders/lookup", inputs: { id: "7", region: "eu" } }`
- **AND** the step SHALL be answered `done` with one `toolCalls` entry carrying those inputs and the host's outputs

#### Scenario: Bad arguments never reach the host
- **GIVEN** a runner that calls the handler with an offered tool and a missing required input
- **WHEN** the request is reasoned
- **THEN** the handler SHALL answer `ok: false` with `missing required input`, the host SHALL not be called, and `toolCalls` SHALL hold one entry with `ok: false` and `outputs: {}`

#### Scenario: A listening run sees the bridge's calls
- **GIVEN** a stream sink passed to `reason`, and a runner that makes one good call through the handler
- **WHEN** the request is reasoned
- **THEN** the sink SHALL receive `tool_call` with the merged inputs, then `tool_result` with `ok: true` and the outputs

### Requirement: mcpBridge serves a step's tools to claude over loopback HTTP
`mcpBridge()` from `@specsesh/agent/node` SHALL return a `ToolBridgeFactory` whose bridge serves Streamable HTTP MCP on `127.0.0.1` only, refusing a request without its random bearer token with `401`. Its `mcpConfig` SHALL be a mode-`0600` file naming the server `agentscript`; `allowedTools` SHALL be `mcp__agentscript__<name>` per tool. `tools/call` SHALL answer through the handler, `!ok` or a throw as `isError`. `close` SHALL stop the server and remove the file.

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

### Requirement: The bridge types are exported from the claude-code entry
`@specsesh/agent/claude-code` SHALL also export the types `BridgeTool`, `BridgeReply`, `BridgeHandler`, `ToolBridge` and `ToolBridgeFactory`, and the constant `BRIDGE_SERVER` (`"agentscript"`).

#### Scenario: The bridge server name is agentscript
- **WHEN** a caller reads `BRIDGE_SERVER` from `@specsesh/agent/claude-code`
- **THEN** it SHALL equal `"agentscript"`
