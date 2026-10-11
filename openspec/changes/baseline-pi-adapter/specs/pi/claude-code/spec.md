## Purpose
Running steps through the user's own `claude` binary, headless, so scripts can run on a Claude subscription within Anthropic's terms: as a `ReasoningPort`, and as a pi-ai provider that anything built on pi (pi-durable included) can select.

## ADDED Requirements

### Requirement: The claude-code surface is exported from the root entry
`agentscript-pi` SHALL export `CLAUDE_CODE_PROVIDER` (`"claude-code"`), `claudeArgs`, `claudeCodeArgs`, `claudeCodeEnv`, `spawnRunner`, `createClaudeCodeReasoningPort`, `toClaudeCodeOutcome`, `CLAUDE_CODE_API` (`"claude-code"`), `CLAUDE_CODE_PROVIDER_ID` (`"claude-code"`), `CLAUDE_CODE_MODELS`, `claudeCodeModel`, `claudeCodeProvider`, `systemPromptOf`, `promptOf` and `toolsOf`, plus the types `ProcessResult`, `Runner`, `ClaudeCodeResult` and the option types.

#### Scenario: The provider id and API are claude-code
- **WHEN** a caller reads `CLAUDE_CODE_PROVIDER`, `CLAUDE_CODE_PROVIDER_ID` and `CLAUDE_CODE_API`
- **THEN** each SHALL equal `"claude-code"`

### Requirement: Claude Code's OAuth token is never read or forwarded
The claude-code port and provider MUST NOT read, copy or forward Claude Code's credentials: no credentials file, keychain or OAuth token is named or read anywhere in their source. Every turn SHALL be made by the `claude` binary itself, logged in as the user.

#### Scenario: The source names no credential
- **WHEN** the port's source is scanned with comments removed
- **THEN** it SHALL NOT match `.credentials`, `claudeAiOauth`, `accessToken`, `ANTHROPIC_OAUTH_TOKEN` or `keychain` (case-insensitive)
- **AND** it SHALL NOT call `readFile`

### Requirement: Each turn is one headless claude -p invocation with a fixed argv
`claudeArgs({ system, model, schema?, maxTurns? })` SHALL return, in order: `-p`, `--safe-mode`, `--model`, `<model>`, `--tools`, `""`, `--no-session-persistence`, `--output-format`, `json`, `--system-prompt`, `<system>`; then `--json-schema`, `<JSON.stringify(schema)>` when a schema is given; then `--max-turns`, `<String(maxTurns)>` when given. The prompt MUST NOT be in argv: it goes on stdin.

#### Scenario: Headless, safe mode, no tools, no saved session
- **WHEN** `claudeArgs({ system: "s", model: "m" })` is called
- **THEN** it SHALL return exactly `["-p", "--safe-mode", "--model", "m", "--tools", "", "--no-session-persistence", "--output-format", "json", "--system-prompt", "s"]`

#### Scenario: A schema and a turn bound are appended in order
- **WHEN** it is called with `schema: { type: "object" }` and `maxTurns: 3`
- **THEN** the argv SHALL end with `--json-schema`, `{"type":"object"}`, `--max-turns`, `3`

### Requirement: --bare is never passed and --safe-mode always is
The argv MUST NOT contain `--bare`, which forces API-key authentication. It MUST always contain `--safe-mode`, which stops the user's CLAUDE.md, skills, plugins, hooks and MCP servers loading into every step.

#### Scenario: Never bare
- **WHEN** argv is built for any request, structured or not
- **THEN** it SHALL NOT contain `--bare` and SHALL contain `--safe-mode`

### Requirement: The port's argv comes from the request and its options
`claudeCodeArgs(request, options)` SHALL call `claudeArgs` with `system` = `request.systemInstructions`, `model` = `options.model` defaulting to `"claude-haiku-4-5"`, `schema` = `request.outputSchema` when present, and `maxTurns` = `options.maxTurns` when given.

#### Scenario: The default model is Haiku
- **WHEN** argv is built with no `model` option
- **THEN** the value after `--model` SHALL be `claude-haiku-4-5`

#### Scenario: Another model is taken
- **WHEN** argv is built with `model: "sonnet"`
- **THEN** the value after `--model` SHALL be `sonnet`

#### Scenario: A text step passes no schema and no turn bound by default
- **WHEN** argv is built for a request without `outputSchema` and options without `maxTurns`
- **THEN** argv SHALL contain neither `--json-schema` nor `--max-turns`

### Requirement: The child environment drops the API key and the nested-session marker
`claudeCodeEnv(parent)` SHALL return a copy of `parent` without `ANTHROPIC_API_KEY` and `CLAUDECODE`, leaving every other variable, and MUST NOT modify `parent`. The port and the provider SHALL spawn with this environment built from `process.env`, so a subscription login is used rather than an API key being billed, and a run started inside a Claude Code session is not refused.

#### Scenario: The key and marker are dropped, the rest kept
- **WHEN** `claudeCodeEnv({ PATH: "/bin", HOME: "/home/x", ANTHROPIC_API_KEY: "sk", CLAUDECODE: "1" })` is called
- **THEN** it SHALL return `{ PATH: "/bin", HOME: "/home/x" }`

#### Scenario: The port spawns with it
- **GIVEN** `process.env.ANTHROPIC_API_KEY` set to `sk-test`
- **WHEN** the port runs a step
- **THEN** the environment handed to the runner SHALL have no `ANTHROPIC_API_KEY`

### Requirement: The port is one claude process per step and stateless
`createClaudeCodeReasoningPort(options)` SHALL return a port whose `reason(request)` runs the runner once with `claudeCodeArgs(request, options)`, `request.prompt` as stdin, and `claudeCodeEnv(process.env)`, then returns `toClaudeCodeOutcome(result, request.outputSchema !== undefined).step`. It SHALL call `onResult` with every parsed result. Without `runner`, it spawns `binary` (default `claude`) with `timeoutMs` (default `300000`).

#### Scenario: Structured output sets variables on the triage example
- **GIVEN** a runner answering the triage example's structured step with `structured_output` `{ severity: "high", urgent: true }`
- **WHEN** the triage script runs through the port
- **THEN** the run SHALL set those variables and the prompt SHALL have been passed on stdin

#### Scenario: onResult sees each parsed result
- **GIVEN** a port with `onResult`
- **WHEN** a step's process prints a JSON result
- **THEN** `onResult` SHALL be called with the parsed object

### Requirement: spawnRunner runs the binary outside any project, with a timeout
`spawnRunner(binary, timeoutMs, signal?)` SHALL return a runner that spawns `binary` with the given argv and environment, `cwd` set to `os.tmpdir()`, writes the input to stdin and closes it, and resolves `{ code, stdout, stderr }` on close. It MUST send `SIGTERM` after `timeoutMs`, and on `signal` abort. A spawn failure MUST resolve `{ code: null, stdout, stderr, spawnError }`, never reject.

#### Scenario: A missing binary resolves with a spawn error
- **WHEN** a runner for a binary that does not exist is run
- **THEN** it SHALL resolve with `code: null` and a `spawnError`

#### Scenario: A process past its timeout is terminated
- **GIVEN** a runner with `timeoutMs` 50 for a process that sleeps
- **WHEN** it runs
- **THEN** the process SHALL receive `SIGTERM` and the runner SHALL resolve with `code` `null`

### Requirement: A missing binary or non-JSON output is a failure that says why
`toClaudeCodeOutcome(result, wantsStructured)` SHALL return `failed` / `unknown` with message `could not start claude: <spawnError.message>. Is Claude Code installed and on PATH?` when `spawnError` is set; and, when stdout is not JSON, `failed` / `unknown` with `claude exited <code or "by signal"> without a JSON result`, plus `: <first 500 chars of trimmed stderr, else stdout>` when non-empty. Neither has `parsed`.

#### Scenario: Claude is not installed
- **WHEN** a result with `spawnError` `spawn claude ENOENT` is mapped
- **THEN** the outcome SHALL be `failed` / `unknown` with a message containing `could not start claude` and `Is Claude Code installed and on PATH?`

#### Scenario: Output that is not JSON carries stderr
- **WHEN** a result with code `1`, stdout `oops` and stderr `bad flag` is mapped
- **THEN** the message SHALL be `claude exited 1 without a JSON result: bad flag`

### Requirement: Max turns is cut short with Claude Code's turn count
When the parsed result's `subtype` is `error_max_turns`, the outcome SHALL be `{ kind: "cut-short", text: result ?? "", turns: num_turns ?? 0 }`. This is the only path in the adapter that reports `cut-short`.

#### Scenario: Max turns settles as cut short
- **WHEN** `{ subtype: "error_max_turns", num_turns: 7, result: "partial" }` is mapped
- **THEN** the outcome SHALL be `{ kind: "cut-short", text: "partial", turns: 7 }`

### Requirement: An error result is a failure with a structured category
When `is_error` is `true`, or `subtype` is set and not `success`, the outcome SHALL be `failed` with category `max_output_tokens` if `stop_reason` is `max_tokens`, else `toFailureCategory(categoryFromStatus(api_error_status))`. The message MUST be `result` when non-empty, else `claude reported <subtype or "an error">`.

#### Scenario: An API error takes its category from the status
- **WHEN** `{ is_error: true, api_error_status: 429, result: "rate limited" }` is mapped
- **THEN** the outcome SHALL be `failed` / `rate_limit` with message `rate limited`

#### Scenario: No status means unknown
- **WHEN** `{ is_error: true, result: "boom" }` is mapped
- **THEN** the category SHALL be `unknown`

#### Scenario: A max_tokens stop is max_output_tokens
- **WHEN** `{ is_error: true, stop_reason: "max_tokens" }` is mapped
- **THEN** the category SHALL be `max_output_tokens`

### Requirement: A success is answered, structured only when asked for
A successful result SHALL map to `{ kind: "answered", text: result ?? "" }`, adding `structured: structured_output` only when `wantsStructured` is true and `structured_output` is present. A structured step without `structured_output` is answered without `structured`, which the interpreter fails.

#### Scenario: A text step answers with text
- **WHEN** `{ subtype: "success", result: "hi" }` is mapped with `wantsStructured` false
- **THEN** the outcome SHALL be `{ kind: "answered", text: "hi" }`

#### Scenario: structured_output is ignored when not asked for
- **WHEN** a success with `structured_output` is mapped with `wantsStructured` false
- **THEN** the outcome SHALL have no `structured`

#### Scenario: A structured step with no structured_output fails the run
- **GIVEN** the triage script and a runner whose structured step returns no `structured_output`
- **WHEN** it runs
- **THEN** the run SHALL end `failed`

### Requirement: The provider registers claude-code with four models
`claudeCodeProvider(options)` SHALL return a pi-ai provider with id `claude-code`, name `Claude Code (your subscription)`, an API-key auth entry named `Claude Code login` that resolves to `{ auth: {} }`, and `models` = `CLAUDE_CODE_MODELS`: `claude-haiku-4-5`, `haiku`, `sonnet`, `opus`, each with api and provider `claude-code`, `baseUrl` `""`, `reasoning` false, input `["text"]`, zero cost, `contextWindow` 200000 and `maxTokens` 32000.

#### Scenario: Haiku is registered
- **GIVEN** a `Models` collection with `claudeCodeProvider()` set
- **WHEN** `getModel("claude-code", "claude-haiku-4-5")` is called
- **THEN** it SHALL return that model

#### Scenario: Only the four listed ids are registered
- **WHEN** `getModel("claude-code", "claude-sonnet-4-5")` is called
- **THEN** it SHALL return `undefined`

### Requirement: claudeCodeModel builds a model for any id
`claudeCodeModel(id)` SHALL return the listed model with that id, or else a model of the same shape with that id and name `<id> (via Claude Code)`. It does not register the model with any collection.

#### Scenario: An unlisted id still gets a model
- **WHEN** `claudeCodeModel("claude-sonnet-4-5")` is called
- **THEN** it SHALL return a model with `provider` `claude-code` and `id` `claude-sonnet-4-5`

### Requirement: The provider flattens pi's system messages into one system prompt
`systemPromptOf(messages)` SHALL read only `system` messages, in order: each non-empty text `content` is appended to a base list, and each `sections` entry sets that section by name, with `null` deleting it. The result SHALL be the base contents, then the surviving section values in first-set order, joined with `"\n\n"`. `toolsOf(messages)` SHALL return every system message's `toolsAdded`, in order.

#### Scenario: Content then sections, later sections replacing earlier ones
- **GIVEN** a system message with content `Base.` and sections `a: "<a>one</a>"`, `b: "<b>two</b>"`, then a later system message with `a: "<a>ONE</a>"`, `b: null`
- **WHEN** `systemPromptOf` is called
- **THEN** it SHALL return `Base.\n\n<a>ONE</a>`

### Requirement: The provider renders the transcript as one prompt
`promptOf(messages)` SHALL ignore system messages. A lone user message SHALL pass through as its text. Otherwise each turn renders as `User: <text>`, `Assistant: <text, with tool calls as [called <name> with <JSON args>]>` or `Tool <name> returned: <text>` / `Tool <name> returned an error: <text>`, joined with `"\n\n"`, followed by `"\n\nContinue from here as the assistant."`.

#### Scenario: A single user turn passes through untouched
- **WHEN** `promptOf` is called with one system and one user message `Say hi`
- **THEN** it SHALL return `Say hi`

#### Scenario: A retry after a tool error is rendered for the model
- **GIVEN** a user turn `Greet`, an assistant `submit_result` call with `{"greeting":3}`, and a tool error `must be a string`
- **WHEN** `promptOf` is called
- **THEN** the prompt SHALL contain `User: Greet`, `[called submit_result with {"greeting":3}]` and `Tool submit_result returned an error: must be a string`
- **AND** it SHALL end with `Continue from here as the assistant.`

### Requirement: The provider refuses more than one pi tool without spawning
A request offering more than one tool SHALL end as an error message, with no process spawned, whose `errorMessage` is `the claude-code provider runs at most one pi tool per request; this one offered <n> (<names, comma-separated>)`. Claude Code runs its own tools, not pi's.

#### Scenario: Two tools are refused
- **WHEN** a request offering tools `a` and `b` is completed
- **THEN** the message SHALL have `stopReason` `error`, an `errorMessage` matching `at most one pi tool` and naming `a, b`
- **AND** the runner SHALL not have been called

### Requirement: The provider answers text, or a call to the one offered tool
The provider SHALL run `claudeArgs` with the flattened system prompt, the model's id and the one tool's `parameters` as schema, with `promptOf` as stdin. A success with `structured_output` and a tool SHALL end `stopReason` `toolUse` with one `toolCall` named after the tool, arguments `structured_output`, id `claude-code-<Date.now()>`. Any other success SHALL end `stop` with one text block of `result`.

#### Scenario: A plain prompt is answered as text
- **WHEN** a request with no tools is answered `Hello!`
- **THEN** the message SHALL have `stopReason` `stop` and content `[{ type: "text", text: "Hello!" }]`
- **AND** argv SHALL contain `--safe-mode`, the system prompt after `--system-prompt`, and no `--json-schema`

#### Scenario: One tool becomes --json-schema and a call to it
- **WHEN** a request offering `submit_result` with a `greeting` string parameter is answered with `structured_output` `{ greeting: "Hello, World!" }`
- **THEN** the message SHALL have `stopReason` `toolUse` and a `toolCall` to `submit_result` with those arguments
- **AND** the `--json-schema` argument SHALL describe `greeting` as a string

### Requirement: Provider failures are error messages carrying the API status
A failed or cut-short outcome SHALL end the stream with `stopReason` `error`: `errorMessage` is the failure's message, or `claude stopped at its turn limit after <n> turns`. When the result has a non-null `api_error_status`, the message SHALL carry `diagnostics: [{ type: "claude-code", timestamp, error: { message: "api error", code: <status> } }]`, so the pi port's status mapping applies.

#### Scenario: An API error keeps its status
- **WHEN** the process reports `{ is_error: true, api_error_status: 429, result: "rate limited" }`
- **THEN** the message SHALL have `errorMessage` `rate limited` and `diagnostics[0].error.code` `429`

#### Scenario: A missing binary is an error message
- **WHEN** the runner reports a spawn error `spawn claude ENOENT`
- **THEN** the message SHALL have `stopReason` `error` and an `errorMessage` containing `ENOENT`

### Requirement: Provider usage is Claude Code's reported tokens and cost
Every provider message SHALL carry `usage` with `input` = `usage.input_tokens`, `output` = `usage.output_tokens` (each defaulting to `0`), `totalTokens` their sum, `cacheRead` and `cacheWrite` `0`, and `cost.total` = `total_cost_usd` (default `0`), which is notional on a subscription.

#### Scenario: Usage is carried through
- **WHEN** the process reports `usage: { input_tokens: 10, output_tokens: 5 }` and `total_cost_usd: 0.001`
- **THEN** the message usage SHALL include `input: 10`, `output: 5`, `totalTokens: 15` and `cost.total: 0.001`

### Requirement: The provider spawns per request with the request's abort signal
Without a `runner` option, the provider SHALL build a fresh `spawnRunner(binary ?? "claude", timeoutMs ?? 300000, signal)` per request, with the request's `StreamOptions.signal`. A `runner` option replaces spawning and receives that signal. The provider never passes `--max-turns`.

#### Scenario: A test runner replaces spawning
- **GIVEN** `claudeCodeProvider({ runner: () => fake })`
- **WHEN** a request is completed
- **THEN** `fake` SHALL receive the argv, the prompt and an environment with no `ANTHROPIC_API_KEY`
