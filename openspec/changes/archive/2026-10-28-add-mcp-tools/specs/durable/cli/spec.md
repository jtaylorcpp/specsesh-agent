## ADDED Requirements

### Requirement: run and resume take --mcp
Both commands SHALL also take `--mcp <file>` (repeatable), loaded and refused as `agentscript-pi run` does, before the harness opens. Its actions join the `--tools` actions in the registry installed with `agentScriptExtensions`. The usage SHALL list it on both lines, `run`'s resume hint SHALL repeat it, and every connection SHALL be closed after the harness closes.

#### Scenario: A durable run calls an MCP tool
- **GIVEN** an `--mcp` file naming the fixture server `fx` and a script that runs `mcpTool://fx/echo`
- **WHEN** the CLI runs `run <script> --db <file> --mcp <mcp>`
- **THEN** the exit code SHALL be `0`, and stderr's resume hint SHALL contain `--mcp <mcp>`

#### Scenario: A resume without the MCP file is refused
- **GIVEN** a stored task whose script runs `mcpTool://fx/echo`
- **WHEN** `resume <id> --db <file>` runs without `--mcp`
- **THEN** stderr SHALL contain `not registered on this host` and the exit code SHALL be `2`
