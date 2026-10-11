## MODIFIED Requirements

### Requirement: The model collection defaults to every built-in provider plus claude-code
When no `models` dependency is injected, the CLI SHALL build its model collection from pi-ai's `builtinModels()` and then register the `claude-code` provider from `@specsesh/agent/claude-code` (`claudeCodeProvider()`), so `--provider claude-code` runs steps through the user's own `claude` binary. Credentials MUST be pi-ai's own environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...); the CLI reads no other credential.

#### Scenario: claude-code is a selectable provider
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider claude-code --model claude-haiku-4-5`
- **THEN** the model SHALL resolve and each step SHALL be sent to the `claude-code` provider
