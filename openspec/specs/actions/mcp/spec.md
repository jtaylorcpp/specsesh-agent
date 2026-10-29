# actions/mcp Specification

## Purpose
MCP servers as a source of host actions: connect to the servers a `.mcp.json`-style config names, list their tools, and map each usable one to a `HostAction` that a script targets as `mcpTool://<server>/<tool>`.

## Requirements

### Requirement: mcpTools connects to every server and maps their tools
`@specsesh/agent/mcp` SHALL export `mcpTools(servers, options?)`. `servers` maps a name to `{ command, args?, env?, cwd? }` (stdio) or `{ url, headers? }` (Streamable HTTP). It SHALL resolve `{ actions, skipped, close }`: one `HostAction` per usable tool, named `<server>/<tool>`, each `{ server, tool, reason }` it could not map, and a `close()` that ends every connection.

#### Scenario: A stdio server's tool becomes an action
- **GIVEN** the fixture server over stdio, named `fx`
- **WHEN** `mcpTools({ fx: { command: "node", args: [<fixture>] } })` resolves
- **THEN** `actions` SHALL include `fx/echo` with inputs `{ text: "string" }` and outputs `{ text: "string" }`

#### Scenario: An HTTP server's tool runs
- **GIVEN** the fixture server over Streamable HTTP at `<url>`, named `fx`
- **WHEN** `fx/echo`'s `execute` is called with `{ text: "hi" }`
- **THEN** it SHALL answer `{ ok: true, outputs: { text: "hi" } }`

#### Scenario: close ends the stdio process
- **WHEN** `close()` resolves
- **THEN** the spawned server process SHALL have exited

### Requirement: A server that cannot connect fails the whole call
If any server fails to start, to complete the handshake or to list its tools within `timeoutMs` (default 30000), `mcpTools` SHALL close every connection already open and reject with `McpServerError`, whose message names the server and the reason. A server named `delegate`, or not matching `^[A-Za-z0-9_-]+$`, SHALL be refused the same way before connecting.

#### Scenario: A crashing server is named
- **GIVEN** two servers, `ok` and `bad`, where `bad` exits before the handshake
- **WHEN** `mcpTools` is called
- **THEN** it SHALL reject naming `bad`, and `ok`'s process SHALL have exited

### Requirement: Config strings expand environment variables
Every string in a server's config SHALL have `${VAR}` and `${VAR:-default}` expanded from `options.env` (default `process.env`). An unset variable with no default SHALL reject naming the server and the variable. A stdio server's environment SHALL be the SDK's default environment plus its `env`, never the whole parent environment.

#### Scenario: A header takes its token from the environment
- **GIVEN** `headers: { Authorization: "Bearer ${FX_TOKEN}" }` and `FX_TOKEN=abc`
- **WHEN** the HTTP fixture records its request headers
- **THEN** `Authorization` SHALL be `Bearer abc`

#### Scenario: A missing variable is named
- **WHEN** a config uses `${NOPE}` and `NOPE` is unset
- **THEN** `mcpTools` SHALL reject naming the server and `NOPE`

### Requirement: Tools map by their required scalar parameters and their outputs
An action's inputs SHALL be its tool's required parameters, each `string`, `number`, `integer` (as `number`) or `boolean`. A tool with a required parameter of any other type SHALL be skipped, naming it. Outputs SHALL be the `outputSchema`'s fields, read from `structuredContent`, when all are scalar, and otherwise `{ text: "string" }`, the result's text items joined with `\n`.

#### Scenario: Structured outputs are read from structuredContent
- **WHEN** `fx/add` (with `outputSchema` `{ sum: number }`) runs with `{ a: 2, b: 3 }`
- **THEN** it SHALL answer `{ ok: true, outputs: { sum: 5 } }`

#### Scenario: A tool with an array parameter is skipped
- **WHEN** the fixture's `tags` tool (required `tags: array`) is listed
- **THEN** `skipped` SHALL hold `{ server: "fx", tool: "tags" }` with a reason naming `tags`, and no action SHALL be named `fx/tags`

### Requirement: Tool errors are failed results and annotations set kind and replay
An `isError` result SHALL answer `{ ok: false }` with its text, and a transport or thrown error `ok: false` with its message. `execute` MUST NOT throw. A tool with `readOnlyHint` SHALL have kind `read`, otherwise `command`, and replay `safe` only with both `readOnlyHint` and `idempotentHint`, otherwise `unsafe`.

#### Scenario: An error result is a failed call
- **WHEN** `fx/fail` runs
- **THEN** it SHALL answer `ok` `false` with the server's error text

#### Scenario: Annotations choose kind and replay
- **WHEN** a read-only, idempotent tool and an unannotated tool are mapped
- **THEN** the first SHALL be `read`/`safe` and the second `command`/`unsafe`
