## ADDED Requirements

### Requirement: run loads MCP servers from --mcp files
`run` SHALL also take `--mcp <file>` (repeatable), and the usage SHALL list it. Each file is JSON with a top-level `mcpServers` object, and the servers of every file are merged and passed to `mcpTools`. The resulting actions join the `--tools` actions in one registry. Each skipped tool SHALL be printed to stderr as `mcp: skipped <server>/<tool>: <reason>` before the run, and every connection SHALL be closed when the command ends.

#### Scenario: A script calls an MCP tool
- **GIVEN** an `--mcp` file naming the fixture server `fx` and a script whose subagent runs `mcpTool://fx/echo`
- **WHEN** the CLI runs `run <script> --mcp <file>`
- **THEN** the exit code SHALL be `0`, the echoed text SHALL be in the variables, and the server process SHALL have exited

### Requirement: A bad --mcp file or server is refused before any model call
A file that is not JSON with an `mcpServers` object, a server name repeated across files, or a server `mcpTools` rejects SHALL print the problem prefixed `--mcp <file>:` (or the `McpServerError` message) and exit `2`, with no model request made and every connection closed.

#### Scenario: A file without mcpServers is refused
- **WHEN** the CLI runs with an `--mcp` file holding `{}`
- **THEN** stderr SHALL contain `--mcp` and `mcpServers`, and the exit code SHALL be `2`

#### Scenario: A server that will not start is refused
- **WHEN** an `--mcp` file names a server whose command exits at once
- **THEN** stderr SHALL name the server, the exit code SHALL be `2`, and no model request SHALL be made
