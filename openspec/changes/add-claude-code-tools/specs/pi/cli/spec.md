## MODIFIED Requirements

### Requirement: claude-code runs steps through the claude binary instead of pi
With provider `claude-code`, `run` SHALL use `createClaudeCodeReasoningPort({ model })` with the chosen model id passed to `claude --model` unresolved, so any id or alias claude accepts works, adding `tools` (the registry's tool host) and `bridge: mcpBridge()` when `--tools` or `--mcp` is given. `--max-tokens` is not used on this path. Every other provider SHALL use `createPiReasoningPort` with the CLI's collection (pi-ai's built-in models, plus `ollama` when it is the provider) and `--max-tokens` as `maxTokens` when given.

#### Scenario: Any claude alias is accepted
- **WHEN** the CLI runs `run x.agent --provider claude-code --model sonnet`
- **THEN** each step SHALL spawn `claude` with `--model sonnet`

#### Scenario: A script runs on a pulled ollama model
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b` that answers every chat request with the text `hello`
- **WHEN** the CLI runs `run hello.agent --provider ollama --model qwen3:8b` on a one-step script with no structured result
- **THEN** stdout SHALL start with `# ollama/qwen3:8b — completed` and the exit code SHALL be `0`

#### Scenario: A claude-code run calls a --tools tool through the bridge
- **GIVEN** a fake `claude` that reads its `--mcp-config` file, calls the first allowed tool over MCP with fixed arguments, and answers with the tool's text as `result`
- **WHEN** the CLI runs `run <script offering echo> --provider claude-code --tools <echo module>`
- **THEN** the exit code SHALL be `0`, stdout SHALL contain the echoed text, and the fake's argv SHALL contain no `--safe-mode`
