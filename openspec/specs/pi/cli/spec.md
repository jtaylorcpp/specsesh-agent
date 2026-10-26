# pi/cli Specification

## Purpose
The `agentscript-pi` command: run an Agent Script file once, in process, on any pi provider or on the user's Claude subscription, and list a provider's models.

## Requirements

### Requirement: The CLI has two commands and prints usage otherwise
`agentscript-pi` SHALL accept `run` or `models` as its first argument. Any other first argument, or none, MUST print the usage text to stderr and exit `2`. The usage MUST begin with `usage:` and list the `agentscript-pi run <file>` form with every `run` flag (`--provider`, `--model`, `--entry`, `--var`, `--max-tokens`, `--json`), wrapped over two lines, and `agentscript-pi models [provider]`.

#### Scenario: An unknown command prints usage
- **WHEN** the CLI runs with `frobnicate`
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

#### Scenario: No command prints usage
- **WHEN** the CLI runs with no arguments
- **THEN** stderr SHALL contain `usage:` and the exit code SHALL be `2`

### Requirement: models lists a provider's models
`models [provider]` SHALL print one line per model of the provider, `<id>\t<name>`, from pi-ai's built-in collection, and exit `0`. The provider SHALL default to `anthropic`. For `claude-code` it SHALL instead print `any id or alias \`claude --model\` accepts: haiku, sonnet, opus, claude-haiku-4-5, ...` and exit `0`. A provider pi does not know prints nothing and exits `0`.

#### Scenario: The default provider is Anthropic
- **WHEN** the CLI runs `models`
- **THEN** stdout SHALL include a line starting `claude-haiku-4-5\t` and the exit code SHALL be `0`

#### Scenario: claude-code describes its ids
- **WHEN** the CLI runs `models claude-code`
- **THEN** stdout SHALL start with `any id or alias`

#### Scenario: An unknown provider prints nothing
- **WHEN** the CLI runs `models nowhere`
- **THEN** stdout SHALL be empty and the exit code SHALL be `0`

### Requirement: run takes a file and its options
`run` SHALL parse `--provider`, `--model`, `--entry` (repeatable), `--var` (repeatable), `--max-tokens` and `--json` (default false), with the first positional as the script file, read as UTF-8. A missing file argument MUST print the usage and exit `2`. Unknown flags, an unreadable file and a bad `--var` throw, and the bin prints `<name>: <message>` to stderr and exits `1`.

#### Scenario: run without a file prints usage
- **WHEN** the CLI runs `run`
- **THEN** the exit code SHALL be `2` with `usage:` on stderr

#### Scenario: An unreadable file is an error, not usage
- **WHEN** the CLI runs `run missing.agent`
- **THEN** stderr SHALL contain `ENOENT` and the exit code SHALL be `1`

### Requirement: Provider and model come from the flag, then the environment, then the defaults
The provider SHALL be `--provider`, else `AGENTSCRIPT_PROVIDER`, else `anthropic`; the model SHALL be `--model`, else `AGENTSCRIPT_MODEL`, else `claude-haiku-4-5`. Credentials are pi-ai's environment variables. For any provider other than `claude-code`, the model MUST be resolved with `resolveModel`, so an unknown one fails with `UnknownModelError` before any request.

#### Scenario: The environment picks the provider and model
- **GIVEN** `AGENTSCRIPT_PROVIDER=claude-code` and `AGENTSCRIPT_MODEL=haiku`
- **WHEN** `run x.agent` is called without flags
- **THEN** each step SHALL run `claude` with `--model haiku`

#### Scenario: An unknown model fails by name
- **WHEN** the CLI runs `run x.agent --model claude-nope`
- **THEN** stderr SHALL contain `UnknownModelError: no model "claude-nope"` and the exit code SHALL be `1`

### Requirement: claude-code runs steps through the claude binary instead of pi
With provider `claude-code`, `run` SHALL use `createClaudeCodeReasoningPort({ model })` with the chosen model id passed to `claude --model` unresolved, so any id or alias claude accepts works. `--max-tokens` is not used on this path. Every other provider SHALL use `createPiReasoningPort` with the CLI's collection (pi-ai's built-in models, plus `ollama` when it is the provider) and `--max-tokens` as `maxTokens` when given.

#### Scenario: Any claude alias is accepted
- **WHEN** the CLI runs `run x.agent --provider claude-code --model sonnet`
- **THEN** each step SHALL spawn `claude` with `--model sonnet`

#### Scenario: A script runs on a pulled ollama model
- **GIVEN** `OLLAMA_HOST` pointing at a fake server listing `qwen3:8b` that answers every chat request with the text `hello`
- **WHEN** the CLI runs `run hello.agent --provider ollama --model qwen3:8b` on a one-step script with no structured result
- **THEN** stdout SHALL start with `# ollama/qwen3:8b — completed` and the exit code SHALL be `0`

### Requirement: --var values are typed by parseVar
`parseVar(raw)` SHALL split at the first `=`: no `=`, or nothing before it, throws `--var expects name=value, got "<raw>"`. The value `True` becomes `true`, `False` becomes `false`, a non-empty value matching `^-?\d+(\.\d+)?$` becomes a number, and anything else, including `""`, stays a string. Overrides go to the run as `variables`, and `--entry` values as `entry`.

#### Scenario: Values are typed
- **WHEN** `parseVar` is called with `report=hello`, `n=3`, `ok=True`, `ok=False`, `s=` and `s=a=b`
- **THEN** it SHALL return `["report","hello"]`, `["n",3]`, `["ok",true]`, `["ok",false]`, `["s",""]` and `["s","a=b"]`

#### Scenario: No name is refused
- **WHEN** `parseVar("=x")` is called
- **THEN** it SHALL throw a message containing `name=value`

### Requirement: Text output lists steps, variables and usage
Without `--json`, `run` SHALL print `# <provider>/<model> — <kind>`, a blank line, then per step `## step <n>: <subagent> → <outcome kind>` followed by `<category>: <message>` for a failure, else the text when non-empty and `structured: <JSON>` when present, each followed by a blank line. Then `## variables`, `<name> = <JSON value>` per variable, and `<in> in / <out> out tokens, $<cost to 5 places>`, with ` (notional on a subscription)` for claude-code.

#### Scenario: A completed run prints its steps and usage
- **WHEN** a one-step script completes on anthropic
- **THEN** stdout SHALL start with `# anthropic/claude-haiku-4-5 — completed` and end with a token and cost line

### Requirement: JSON output is the run result with provider, model and usage
With `--json`, `run` SHALL print `JSON.stringify({ provider, model, kind, steps, variables, usage: { in, out, cost } }, null, 2)`. Usage totals SHALL sum every step: pi messages' `usage.input`, `usage.output` and `usage.cost.total`, or Claude Code results' `input_tokens`, `output_tokens` and `total_cost_usd`.

#### Scenario: JSON output carries usage
- **WHEN** the CLI runs `run x.agent --json`
- **THEN** stdout SHALL parse as JSON with `provider`, `model`, `kind`, `steps`, `variables` and `usage`

### Requirement: The exit code is the run's kind
`run` SHALL exit `0` when the run's `kind` is `completed` and `1` when it is `failed` or `cut-short`.

#### Scenario: A failed run exits 1
- **WHEN** a run ends `failed`
- **THEN** the exit code SHALL be `1`

### Requirement: The bin is the compiled CLI
The `agentscript-pi` bin SHALL be `dist/bin/agentscript-pi.js`, compiled from `src/bin/agentscript-pi.ts`, starting with `#!/usr/bin/env node`, and SHALL run the CLI in-process with no `tsx`. It SHALL exit with the CLI's exit code, and print an uncaught error as `<name>: <message>` on stderr and exit `1`.

#### Scenario: Arguments and exit code pass through
- **WHEN** the bin runs `frobnicate`
- **THEN** it SHALL exit `2` with the usage on stderr

#### Scenario: The installed bin needs no tsx
- **GIVEN** the packed tarball installed in an empty project with no `tsx`
- **WHEN** `npx agentscript-pi models claude-code` runs there
- **THEN** it SHALL exit `0` and print the claude-code model hint

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
