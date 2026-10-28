## ADDED Requirements

### Requirement: claude-code durable runs offer tools through the bridge
The bins' model collection SHALL register `claudeCodeProvider({ bridge: mcpBridge() })`, so `run` and `resume` on provider `claude-code` with `--tools` or `--mcp` offer a step's tools to Claude Code. Each call SHALL run in the harness as a host action, recorded in the step's actions like any other provider's. The usage SHALL NOT say such a step fails.

#### Scenario: A durable claude-code run calls a --tools tool
- **GIVEN** a fake `claude` on `PATH` that reads its `--mcp-config` file, calls the first allowed tool over MCP with fixed arguments, and answers with the tool's text as `result`
- **WHEN** the CLI runs `run <script offering echo> --db <db> --provider claude-code --tools <echo module>`
- **THEN** the exit code SHALL be `0`, and the step's recorded actions SHALL hold one `echo` call with those arguments

#### Scenario: The usage no longer refuses claude-code tools
- **WHEN** the durable CLI prints its usage
- **THEN** it SHALL NOT contain `a step that offers tools fails`
