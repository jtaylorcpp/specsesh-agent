## ADDED Requirements

### Requirement: claude-code runs offered tools through mcpBridge
With provider `claude-code` and `--tools` or `--mcp`, `run` SHALL create the claude-code port with `tools` set to the registry's tool host and `bridge` set to `mcpBridge()`, so a step's offered tools are called by Claude Code and run on this host. Without either flag the port is created as before.

#### Scenario: A claude-code run calls a --tools tool through the bridge
- **GIVEN** a fake `claude` that reads its `--mcp-config` file, calls the first allowed tool over MCP with fixed arguments, and answers with the tool's text as `result`
- **WHEN** the CLI runs `run <script offering echo> --provider claude-code --tools <echo module>`
- **THEN** the exit code SHALL be `0`, stdout SHALL contain the echoed text, and the fake's argv SHALL contain no `--safe-mode`
