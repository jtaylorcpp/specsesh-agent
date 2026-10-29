## MODIFIED Requirements

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

