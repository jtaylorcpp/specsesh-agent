## MODIFIED Requirements

### Requirement: The model collection defaults to every built-in provider plus claude-code
When no `models` dependency is injected, the CLI SHALL build its model collection from pi-ai's `builtinModels()` and then register the `claude-code` provider from `@specsesh/agent/claude-code` (`claudeCodeProvider()`), so `--provider claude-code` runs steps through the user's own `claude` binary. Credentials MUST be pi-ai's own environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...); the CLI reads no other credential.

#### Scenario: claude-code is a selectable provider
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider claude-code --model claude-haiku-4-5`
- **THEN** the model SHALL resolve and each step SHALL be sent to the `claude-code` provider

### Requirement: parseVar types a name=value pair the way the dialect spells values
The durable CLI module, `src/bin/agentscript-durable.ts`, SHALL export `parseVar(raw)` (not a public entry point), splitting at the first `=`. A raw string with no `=`, or with `=` as its first character, MUST throw `--var expects name=value, got "<raw>"`. The value MUST become `true` for exactly `True`, `false` for exactly `False`, a number when it is non-empty and matches `^-?\d+(\.\d+)?$`, and the string as written otherwise. Everything after the first `=` belongs to the value.

#### Scenario: Values are typed
- **WHEN** `parseVar` is called with `a=b`, `n=2`, `t=True` and `f=False`
- **THEN** it SHALL return `["a", "b"]`, `["n", 2]`, `["t", true]` and `["f", false]`

#### Scenario: Lower-case booleans and empty values stay strings
- **WHEN** `parseVar` is called with `t=true` and `e=`
- **THEN** it SHALL return `["t", "true"]` and `["e", ""]`

#### Scenario: A value may contain =
- **WHEN** `parseVar("q=a=b")` is called
- **THEN** it SHALL return `["q", "a=b"]`

#### Scenario: A pair without a name is refused
- **WHEN** `parseVar` is called with `=x` or `novalue`
- **THEN** it SHALL throw an error containing `--var expects name=value`
