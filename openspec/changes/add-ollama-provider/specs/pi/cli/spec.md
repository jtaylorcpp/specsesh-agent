## MODIFIED Requirements

### Requirement: models lists a provider's models
`models [provider]` SHALL print one line per model of the provider, `<id>\t<name>`, from pi-ai's built-in collection, and exit `0`. The provider SHALL default to `anthropic`. For `claude-code` it SHALL instead print `any id or alias \`claude --model\` accepts: haiku, sonnet, opus, claude-haiku-4-5, ...` and exit `0`. For `ollama` it SHALL call `registerOllama` and print the pulled models the same way, or, when the server is unreachable, print `ollama: not reachable at <url>: <reason>` to stderr and exit `1`. A provider pi does not know prints nothing and exits `0`.

#### Scenario: The default provider is Anthropic
- **WHEN** the CLI runs `models`
- **THEN** stdout SHALL include a line starting `claude-haiku-4-5\t` and the exit code SHALL be `0`

#### Scenario: claude-code describes its ids
- **WHEN** the CLI runs `models claude-code`
- **THEN** stdout SHALL start with `any id or alias`

#### Scenario: An unknown provider prints nothing
- **WHEN** the CLI runs `models nowhere`
- **THEN** stdout SHALL be empty and the exit code SHALL be `0`

#### Scenario: ollama lists the pulled models
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b`
- **WHEN** the CLI runs `models ollama`
- **THEN** stdout SHALL be `qwen3:8b\tqwen3:8b (Ollama)` and the exit code SHALL be `0`

#### Scenario: An unreachable ollama is reported
- **GIVEN** `OLLAMA_HOST` pointing at a port nothing listens on
- **WHEN** the CLI runs `models ollama`
- **THEN** stderr SHALL start with `ollama: not reachable at ` followed by that URL, and the exit code SHALL be `1`

### Requirement: Provider and model come from the flag, then the environment, then the defaults
The provider SHALL be `--provider`, else `AGENTSCRIPT_PROVIDER`, else `anthropic`; the model SHALL be `--model`, else `AGENTSCRIPT_MODEL`, else `claude-haiku-4-5`. Credentials are pi-ai's environment variables. With provider `ollama`, `run` SHALL first call `registerOllama`; an unreachable server MUST print `ollama: not reachable at <url>: <reason>` and exit `1` before any request. For any provider other than `claude-code`, the model MUST be resolved with `resolveModel`, so an unknown one fails with `UnknownModelError` before any request.

#### Scenario: The environment picks the provider and model
- **GIVEN** `AGENTSCRIPT_PROVIDER=claude-code` and `AGENTSCRIPT_MODEL=haiku`
- **WHEN** `run x.agent` is called without flags
- **THEN** each step SHALL run `claude` with `--model haiku`

#### Scenario: An unknown model fails by name
- **WHEN** the CLI runs `run x.agent --model claude-nope`
- **THEN** stderr SHALL contain `UnknownModelError: no model "claude-nope"` and the exit code SHALL be `1`

#### Scenario: A model ollama has not pulled fails by name
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b`
- **WHEN** the CLI runs `run x.agent --provider ollama --model nope:1b`
- **THEN** stderr SHALL contain `UnknownModelError: no model "nope:1b" on provider "ollama"` and `qwen3:8b`, and the exit code SHALL be `1`

#### Scenario: An unreachable ollama stops run before any request
- **GIVEN** `OLLAMA_HOST` pointing at a port nothing listens on
- **WHEN** the CLI runs `run x.agent --provider ollama --model qwen3:8b`
- **THEN** stderr SHALL start with `ollama: not reachable at ` and the exit code SHALL be `1`

### Requirement: claude-code runs steps through the claude binary instead of pi
With provider `claude-code`, `run` SHALL use `createClaudeCodeReasoningPort({ model })` with the chosen model id passed to `claude --model` unresolved, so any id or alias claude accepts works. `--max-tokens` is not used on this path. Every other provider SHALL use `createPiReasoningPort` with the CLI's collection (pi-ai's built-in models, plus `ollama` when it is the provider) and `--max-tokens` as `maxTokens` when given.

#### Scenario: Any claude alias is accepted
- **WHEN** the CLI runs `run x.agent --provider claude-code --model sonnet`
- **THEN** each step SHALL spawn `claude` with `--model sonnet`

#### Scenario: A script runs on a pulled ollama model
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b` that answers every chat request with the text `hello`
- **WHEN** the CLI runs `run hello.agent --provider ollama --model qwen3:8b` on a one-step script with no structured result
- **THEN** stdout SHALL start with `# ollama/qwen3:8b — completed` and the exit code SHALL be `0`
