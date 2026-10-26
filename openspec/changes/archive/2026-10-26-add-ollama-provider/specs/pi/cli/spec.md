## MODIFIED Requirements

### Requirement: claude-code runs steps through the claude binary instead of pi
With provider `claude-code`, `run` SHALL use `createClaudeCodeReasoningPort({ model })` with the chosen model id passed to `claude --model` unresolved, so any id or alias claude accepts works. `--max-tokens` is not used on this path. Every other provider SHALL use `createPiReasoningPort` with the CLI's collection (pi-ai's built-in models, plus `ollama` when it is the provider) and `--max-tokens` as `maxTokens` when given.

#### Scenario: Any claude alias is accepted
- **WHEN** the CLI runs `run x.agent --provider claude-code --model sonnet`
- **THEN** each step SHALL spawn `claude` with `--model sonnet`

#### Scenario: A script runs on a pulled ollama model
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b` that answers every chat request with the text `hello`
- **WHEN** the CLI runs `run hello.agent --provider ollama --model qwen3:8b` on a one-step script with no structured result
- **THEN** stdout SHALL start with `# ollama/qwen3:8b — completed` and the exit code SHALL be `0`

## ADDED Requirements

### Requirement: ollama is reached only when it is the provider
With provider `ollama`, `models` and `run` SHALL first call `registerOllama`, and `models ollama` SHALL print the pulled models as `<id>\t<name>`. An unreachable server MUST print `ollama: not reachable at <url>: <reason>` to stderr and exit `1`, before any model request. No other provider SHALL contact the Ollama server.

#### Scenario: ollama lists the pulled models
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b`
- **WHEN** the CLI runs `models ollama`
- **THEN** stdout SHALL be `qwen3:8b\tqwen3:8b (Ollama)` and the exit code SHALL be `0`

#### Scenario: An unreachable ollama is reported
- **GIVEN** `OLLAMA_HOST` pointing at a port nothing listens on
- **WHEN** the CLI runs `models ollama`
- **THEN** stderr SHALL start with `ollama: not reachable at ` followed by that URL, and the exit code SHALL be `1`

#### Scenario: A model ollama has not pulled fails by name
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b`
- **WHEN** the CLI runs `run x.agent --provider ollama --model nope:1b`
- **THEN** stderr SHALL contain `UnknownModelError: no model "nope:1b" on provider "ollama"` and `qwen3:8b`, and the exit code SHALL be `1`

#### Scenario: An unreachable ollama stops run before any request
- **GIVEN** `OLLAMA_HOST` pointing at a port nothing listens on
- **WHEN** the CLI runs `run x.agent --provider ollama --model qwen3:8b`
- **THEN** stderr SHALL start with `ollama: not reachable at ` and the exit code SHALL be `1`
