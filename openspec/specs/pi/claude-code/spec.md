# pi/claude-code Specification

## Purpose
Running steps through the user's own `claude` binary, headless, so scripts can run on a Claude subscription within Anthropic's terms: as a `ReasoningPort`, and as a pi-ai provider that anything built on pi (pi-durable included) can select.

## Requirements

### Requirement: The claude-code surface is exported from the root entry
`@specsesh/agent/claude-code` SHALL export `CLAUDE_CODE_PROVIDER` (`"claude-code"`), `claudeCodeArgs`, `claudeCodeEnv`, `createClaudeCodeReasoningPort`, `toClaudeCodeOutcome`, `CLAUDE_CODE_API` (`"claude-code"`), `CLAUDE_CODE_PROVIDER_ID` (`"claude-code"`), `CLAUDE_CODE_MODELS`, `claudeCodeModel`, `claudeCodeProvider`, `systemPromptOf`, `promptOf` and `toolsOf`, plus the types `ProcessResult`, `Runner`, `ClaudeCodeResult` and the option types.

#### Scenario: Argv building and spawning stay module-level
- **WHEN** a caller imports `@specsesh/agent/claude-code`
- **THEN** `claudeArgs` and `spawnRunner` SHALL NOT be among its exports; they are exports of `src/claude-code/claude-code.ts` only

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
`claudeArgs({ system, model, schema?, maxTurns?, tools? })` without `tools` SHALL return, in order: `-p`, `--safe-mode`, `--model`, `<model>`, `--tools`, `""`, `--no-session-persistence`, `--output-format`, `json`, `--system-prompt`, `<system with the no-workspace note>`; then `--json-schema`, `<JSON.stringify(schema)>` when a schema is given; then `--max-turns`, `<String(maxTurns)>` when given. The prompt MUST NOT be in argv: it goes on stdin.

#### Scenario: Headless, safe mode, no tools, no saved session
- **WHEN** `claudeArgs({ system: "s", model: "m" })` is called
- **THEN** it SHALL return exactly `["-p", "--safe-mode", "--model", "m", "--tools", "", "--no-session-persistence", "--output-format", "json", "--system-prompt", <"s", "\n\n" and the no-workspace note>]`

#### Scenario: A schema and a turn bound are appended in order
- **WHEN** it is called with `schema: { type: "object" }` and `maxTurns: 3`
- **THEN** the argv SHALL end with `--json-schema`, `{"type":"object"}`, `--max-turns`, `3`

### Requirement: --bare is never passed and --safe-mode always is
The argv MUST NOT contain `--bare`, which forces API-key authentication. Without `tools` it MUST contain `--safe-mode`, which stops the user's CLAUDE.md, skills, plugins, hooks and MCP servers loading into every step. With `tools` it MUST instead contain `--setting-sources ""`, `--disable-slash-commands` and `--strict-mcp-config`, because `--safe-mode` also turns off the step's own MCP server.

#### Scenario: Never bare
- **WHEN** argv is built without `tools` for any request, structured or not
- **THEN** it SHALL NOT contain `--bare` and SHALL contain `--safe-mode`

#### Scenario: A tool step is isolated without safe mode
- **WHEN** argv is built with `tools`
- **THEN** it SHALL NOT contain `--bare` or `--safe-mode`
- **AND** it SHALL contain `--setting-sources` followed by `""`, `--disable-slash-commands` and `--strict-mcp-config`

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
`createClaudeCodeReasoningPort(options)` SHALL return a port whose `reason(request)` runs the runner once with `claudeCodeArgs(request, options)`, `request.prompt` as stdin, and `claudeCodeEnv(process.env)`, then returns `toClaudeCodeOutcome(result, request.outputSchema !== undefined).step`. It SHALL call `onResult` with every parsed result. Without `runner`, it spawns `binary` (default `claude`) with `timeoutMs` (default `300000`) and `cwd`.

#### Scenario: Structured output sets variables on the triage example
- **GIVEN** a runner answering the triage example's structured step with `structured_output` `{ severity: "high", urgent: true }`
- **WHEN** the triage script runs through the port
- **THEN** the run SHALL set those variables and the prompt SHALL have been passed on stdin

#### Scenario: onResult sees each parsed result
- **GIVEN** a port with `onResult`
- **WHEN** a step's process prints a JSON result
- **THEN** `onResult` SHALL be called with the parsed object

#### Scenario: The port runs claude in its cwd option
- **GIVEN** a fake `claude` binary that answers with its working directory as `result`, and a port with that `binary` and `cwd` set to an existing directory
- **WHEN** a text step runs through the port
- **THEN** the step's answer SHALL be that directory

### Requirement: spawnRunner runs the binary outside any project, with a timeout
`spawnRunner(binary, timeoutMs, signal?, cwd?)` SHALL return a runner that spawns `binary` with the given argv and environment, writes the input to stdin and closes it, and resolves `{ code, stdout, stderr }` on close. Without `cwd`, each call SHALL run in a new empty directory made by `mkdtemp` under `os.tmpdir()`, removed before the call resolves; with `cwd`, there. It MUST send `SIGTERM` after `timeoutMs`, and on abort. A spawn failure MUST resolve with `spawnError`, never reject.

#### Scenario: A missing binary resolves with a spawn error
- **WHEN** a runner for a binary that does not exist is run
- **THEN** it SHALL resolve with `code: null` and a `spawnError`

#### Scenario: A process past its timeout is terminated
- **GIVEN** a runner with `timeoutMs` 50 for a process that sleeps
- **WHEN** it runs
- **THEN** the process SHALL receive `SIGTERM` and the runner SHALL resolve with `code` `null`

#### Scenario: Each call runs in a fresh empty directory, removed after
- **GIVEN** a runner without `cwd` for a process that prints its working directory and the entries in it
- **WHEN** it is run twice
- **THEN** each run SHALL report a different directory under `os.tmpdir()`, neither equal to `os.tmpdir()`, each with no entries
- **AND** neither directory SHALL exist after its run resolves

#### Scenario: A given cwd is used and left in place
- **GIVEN** a runner with `cwd` set to an existing directory holding one file
- **WHEN** a process that prints its working directory runs
- **THEN** it SHALL report that directory, and the directory and its file SHALL still exist after the run resolves

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
Without a `bridge` option, a request offering more than one tool SHALL end as an error message, with no process spawned, whose `errorMessage` is `the claude-code provider runs at most one pi tool per request without a bridge; this one offered <n> (<names, comma-separated>)`.

#### Scenario: Two tools are refused
- **WHEN** a request offering tools `a` and `b` is completed by a provider without `bridge`
- **THEN** the message SHALL have `stopReason` `error`, an `errorMessage` matching `at most one pi tool` and `without a bridge`, and naming `a, b`
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
Without a `runner` option, the provider SHALL build a fresh `spawnRunner(binary ?? "claude", timeoutMs ?? 300000, signal, cwd)` per spawned process, with the `cwd` option. A non-bridged request's process gets that request's `StreamOptions.signal` and no `--max-turns`; a bridged session's process gets the session's own signal. A `runner` option replaces spawning and receives that signal.

#### Scenario: A test runner replaces spawning
- **GIVEN** `claudeCodeProvider({ runner: () => fake })`
- **WHEN** a request is completed
- **THEN** `fake` SHALL receive the argv, the prompt and an environment with no `ANTHROPIC_API_KEY`

#### Scenario: The provider runs claude in its cwd option
- **GIVEN** a fake `claude` binary that answers with its working directory as `result`, and `claudeCodeProvider({ binary, cwd })` with `cwd` set to an existing directory
- **WHEN** a request with no tools is completed
- **THEN** the message's text SHALL be that directory

### Requirement: The system prompt ends with the no-workspace note
The `--system-prompt` value `claudeArgs` builds SHALL end with this note, after `\n\n` when the system text is non-empty and alone when it is empty: `This step has no workspace. The environment details you may see (working directory, whether it is a git repository, platform) describe the process running this step, not the project the step is about; ignore them.` The port and the provider SHALL both pass it.

#### Scenario: The note follows the system text
- **WHEN** `claudeArgs({ system: "s", model: "m" })` is called
- **THEN** the value after `--system-prompt` SHALL be `s`, then `\n\n`, then the note exactly

#### Scenario: An empty system text is the note alone
- **WHEN** `claudeArgs({ system: "", model: "m" })` is called
- **THEN** the value after `--system-prompt` SHALL be the note exactly

#### Scenario: The port passes the note
- **WHEN** the triage script runs through `createClaudeCodeReasoningPort` with a recording runner
- **THEN** every `--system-prompt` value SHALL contain `You triage bug reports` and end with the note

#### Scenario: The provider passes the note
- **WHEN** a provider request whose system content is `Be kind.` is completed with a recording runner
- **THEN** the value after `--system-prompt` SHALL be `Be kind.`, then `\n\n`, then the note exactly

### Requirement: A tool step names one MCP server and allows only its tools
With `tools: { mcpConfig, allowedTools }`, `claudeArgs` SHALL put, in place of `--safe-mode`: `--setting-sources`, `""`, `--disable-slash-commands`, `--strict-mcp-config`, `--mcp-config`, `<mcpConfig>`, `--allowedTools`, `<allowedTools joined with ",">`, `--permission-mode`, `dontAsk`. Every other argument SHALL be as without `tools`, `--tools ""` included.

#### Scenario: The tool flags replace safe mode in place
- **WHEN** `claudeArgs({ system: "s", model: "m", tools: { mcpConfig: "/x/mcp.json", allowedTools: ["mcp__agentscript__a", "mcp__agentscript__b"] } })` is called
- **THEN** it SHALL return `-p`, then `--setting-sources`, `""`, `--disable-slash-commands`, `--strict-mcp-config`, `--mcp-config`, `/x/mcp.json`, `--allowedTools`, `mcp__agentscript__a,mcp__agentscript__b`, `--permission-mode`, `dontAsk`, then the same arguments that follow `--safe-mode` without `tools`

### Requirement: The port runs offered tools through a bridge when given a tool host
`createClaudeCodeReasoningPort` SHALL take `tools?: PiToolHost` and `bridge?: ToolBridgeFactory`; `tools` without `bridge` SHALL throw a `TypeError` naming `mcpBridge`. For a request with `tools`, it SHALL start the bridge with the offers, run one `claude -p` with the bridge's `tools` and `--max-turns` `maxTurns ?? 16`, and close the bridge on every path. Without `tools`, such a request is refused as before.

#### Scenario: tools need a bridge
- **WHEN** `createClaudeCodeReasoningPort({ tools: host })` is called without `bridge`
- **THEN** it SHALL throw a `TypeError` whose message contains `mcpBridge`

#### Scenario: A tool step passes the bridge's server and a turn bound
- **GIVEN** a port with a tool host and a fake bridge answering `mcpConfig` `/b/mcp.json` and `allowedTools` `["mcp__agentscript__lookup"]`
- **WHEN** a request offering `lookup` is reasoned
- **THEN** the runner's argv SHALL contain `--mcp-config`, `/b/mcp.json`, `--allowedTools`, `mcp__agentscript__lookup` and `--max-turns`, `16`, and no `--safe-mode`
- **AND** the bridge SHALL have been closed after the runner resolved

#### Scenario: The bridge is closed when the step fails
- **GIVEN** a port with a tool host, a fake bridge and a runner reporting `{ is_error: true, result: "boom" }`
- **WHEN** a request offering a tool is reasoned
- **THEN** the step SHALL fail and the bridge SHALL have been closed

#### Scenario: A bridge that will not start fails the step
- **GIVEN** a bridge factory that rejects with `no port`
- **WHEN** a request offering a tool is reasoned
- **THEN** the step SHALL fail `unknown` with a message containing `could not start the tool bridge: no port`, and the runner SHALL not have been called

#### Scenario: An unservable tool name is refused before spawning
- **WHEN** a request offering a tool named `has space` is reasoned by a port with a tool host and a bridge
- **THEN** the step SHALL fail `invalid_request` with a message naming `has space`, and neither the bridge nor the runner SHALL have been called

### Requirement: Calls through the bridge are checked, run on the host and recorded
The bridge handler SHALL refuse an unoffered name unrecorded, and refuse arguments failing `checkToolArguments` with `ok: false`, recorded with `outputs: {}`. Otherwise it SHALL call the host with `{ name, tool: offer.action, inputs: { ...args, ...offer.bound } }`, a throw being `ok: false`, and answer `JSON.stringify(outputs)` or the message. Once the bridge has started, every outcome of the step SHALL carry every recorded call in arrival order as `toolCalls`.

#### Scenario: A call runs on the host with bound inputs winning
- **GIVEN** an offer `lookup` for action `orders/lookup` with bound `{ region: "eu" }`, and a runner that calls the handler with `lookup` and `{ id: "7", region: "us" }` before answering `done`
- **WHEN** the request is reasoned
- **THEN** the host SHALL be called with `{ name: "lookup", tool: "orders/lookup", inputs: { id: "7", region: "eu" } }`
- **AND** the step SHALL be answered `done` with one `toolCalls` entry carrying those inputs and the host's outputs

#### Scenario: Bad arguments never reach the host
- **GIVEN** a runner that calls the handler with an offered tool and a missing required input
- **WHEN** the request is reasoned
- **THEN** the handler SHALL answer `ok: false` with `missing required input`, the host SHALL not be called, and `toolCalls` SHALL hold one entry with `ok: false` and `outputs: {}`

#### Scenario: A listening run sees the bridge's calls
- **GIVEN** a stream sink passed to `reason`, and a runner that makes one good call through the handler
- **WHEN** the request is reasoned
- **THEN** the sink SHALL receive `tool_call` with the merged inputs, then `tool_result` with `ok: true` and the outputs

#### Scenario: A tool step that fails keeps its calls
- **GIVEN** a runner that makes one good call through the handler, then reports `{ is_error: true, result: "boom" }`
- **WHEN** the request is reasoned
- **THEN** the step SHALL be failed with `boom`, and `toolCalls` SHALL hold that call with the host's outputs

### Requirement: mcpBridge serves a step's tools to claude over loopback HTTP
`mcpBridge()` from `@specsesh/agent/node` SHALL return a `ToolBridgeFactory` whose bridge serves Streamable HTTP MCP on `127.0.0.1` only, refusing a request without its random bearer token with `401`. Its `mcpConfig` SHALL be a mode-`0600` file naming the server `agentscript`; `allowedTools` SHALL be `mcp__agentscript__<name>` per tool. `tools/call` SHALL answer through the handler, `!ok` or a throw as `isError`. `close` SHALL stop the server and remove the file.

#### Scenario: The bridge lists and calls its tools
- **GIVEN** a bridge for one tool `echo` whose handler answers `{ ok: true, text: "hi" }`
- **WHEN** an MCP client connects with the URL and header from its `mcpConfig` file, lists tools and calls `echo`
- **THEN** the list SHALL hold `echo` with its input schema, and the call SHALL answer text `hi`

#### Scenario: A request without the token is refused
- **WHEN** a POST reaches the bridge's URL without the `Authorization` header
- **THEN** it SHALL be answered `401` and the handler SHALL not be called

#### Scenario: A failing handler is an error result
- **GIVEN** a bridge whose handler throws `nope`
- **WHEN** a client calls the tool
- **THEN** the result SHALL have `isError: true` and text `nope`

#### Scenario: The config file is private and removed on close
- **WHEN** a bridge is started and then closed
- **THEN** its `mcpConfig` file SHALL have had mode `0600` while open, its `allowedTools` SHALL be `["mcp__agentscript__echo"]`, and the file SHALL not exist after `close`

### Requirement: The bridge types are exported from the claude-code entry
`@specsesh/agent/claude-code` SHALL also export the types `BridgeTool`, `BridgeReply`, `BridgeHandler`, `ToolBridge` and `ToolBridgeFactory`, and the constant `BRIDGE_SERVER` (`"agentscript"`).

#### Scenario: The bridge server name is agentscript
- **WHEN** a caller reads `BRIDGE_SERVER` from `@specsesh/agent/claude-code`
- **THEN** it SHALL equal `"agentscript"`

### Requirement: With a bridge, a request offering tools runs a held claude session
With `bridge`, a request offering any tool not named `submit_result` SHALL start a session: the bridge serving those tools, then one process with the bridge's `tools`, `--max-turns` `16`, and `submit_result`'s parameters as `--json-schema` when offered. A name failing `^[A-Za-z0-9_-]{1,48}$` SHALL end the request as an error message, starting nothing. Any other request is unaffected.

#### Scenario: A bridged request starts one session
- **GIVEN** `claudeCodeProvider({ runner, bridge })` with a fake bridge
- **WHEN** a request offering `lookup` and `submit_result` is completed
- **THEN** the bridge SHALL have been started with `lookup` only, and the runner's argv SHALL contain `--mcp-config`, `--max-turns`, `16` and `--json-schema` with `submit_result`'s parameters

#### Scenario: Only submit_result is not bridged
- **WHEN** a request offering only `submit_result` is completed by a provider with `bridge`
- **THEN** the bridge SHALL not have been started, and the argv SHALL contain `--safe-mode` and `--json-schema`

#### Scenario: An unservable name starts nothing
- **WHEN** a request offering a tool named `has space` is completed by a provider with `bridge`
- **THEN** the message SHALL have `stopReason` `error` naming `has space`, and neither the bridge nor the runner SHALL have been called

### Requirement: Held calls become pi tool calls and their results go back to claude
While a session's process runs, each call through the bridge SHALL be held. The request SHALL end `toolUse`, carrying every held call not yet handed out, in arrival order, each with a fresh id `claude-code-<uuid>`. A later request whose trailing `toolResult`s name those ids SHALL resolve each held call with `{ ok: !isError, text }` and wait on the same session. When the process ends, the bridge SHALL close and the result SHALL map as for an unbridged request.

#### Scenario: A held call is handed out, answered and continued
- **GIVEN** a bridged session whose runner calls `lookup` with `{ id: "7" }` through the handler and answers `found it` after the reply
- **WHEN** the first request is completed, and then a second request appending a `toolResult` for the returned id with text `{"status":"shipped"}`
- **THEN** the first message SHALL have `stopReason` `toolUse` and one `toolCall` to `lookup` with `{ id: "7" }`
- **AND** the handler SHALL have answered `{ ok: true, text: "{\"status\":\"shipped\"}" }`, the second message SHALL be the text `found it`, the runner SHALL have been called once, and the bridge SHALL have been closed

#### Scenario: Calls made together arrive in one message
- **GIVEN** a runner that calls `a` and `b` through the handler without awaiting the first
- **WHEN** the request is completed
- **THEN** the message SHALL carry two `toolCall`s, to `a` and then to `b`, with different ids

#### Scenario: An error result reaches claude as an error
- **GIVEN** a held call answered by a `toolResult` with `isError: true` and text `no such order`
- **WHEN** the request carrying it is completed
- **THEN** the handler SHALL have answered `{ ok: false, text: "no such order" }`

#### Scenario: A structured answer ends as a submit_result call
- **GIVEN** a bridged session offering `submit_result`, whose process answers with `structured_output` `{ ok: true }` after one held call
- **WHEN** the request carrying that call's result is completed
- **THEN** the message SHALL have `stopReason` `toolUse` and one `toolCall` to `submit_result` with `{ ok: true }`

#### Scenario: Calls one after another share one process
- **GIVEN** a bridged session whose runner calls `lookup` with `{ id: "1" }`, awaits the reply, then calls it with `{ id: "2" }`
- **WHEN** three requests are completed, each appending the previous message and a `toolResult` for its call (texts `one`, then `two`)
- **THEN** the second message SHALL carry one `toolCall` to `lookup` with `{ id: "2" }`, the third SHALL be the runner's text, the handler SHALL have answered `one` then `two`, the runner SHALL have been called once, and the bridge closed once

#### Scenario: Results for calls made together are all handed back
- **GIVEN** a runner that calls `lookup` twice without awaiting the first and answers with both replies' texts joined
- **WHEN** the request carrying both calls' `toolResult`s (`A`, `B`) is completed
- **THEN** the message SHALL be the text `AB`

#### Scenario: A process that exits while a call is held ends the session
- **GIVEN** a runner that calls `lookup` without awaiting it, then exits with code `1` and no JSON
- **WHEN** the call is handed out, and a request carrying its `toolResult` is completed
- **THEN** that request SHALL end as an error message, the bridge SHALL have been closed once, and the runner SHALL have been called at most twice

### Requirement: Results that name no live session start a fresh process
A bridged request whose trailing `toolResult`s name no live session's held call SHALL start a new session whose prompt is `promptOf` of the whole transcript, prior calls and results included, so a resumed run continues after a crash.

#### Scenario: A resumed transcript goes to a fresh process
- **GIVEN** a new provider and a request whose transcript holds a `lookup` call with id `claude-code-old` and its `toolResult`
- **WHEN** the request is completed
- **THEN** the runner SHALL have been called with a prompt containing `[called lookup with` and `Tool lookup returned:`

### Requirement: An aborted request ends its session
When a request's `StreamOptions.signal` aborts while it waits on a session, the provider SHALL abort the session's runner signal, close the bridge, drop the session, and end the message `stopReason` `aborted`.

#### Scenario: Aborting kills the held process
- **GIVEN** a bridged session whose runner waits on its signal
- **WHEN** the request's signal is aborted
- **THEN** the message SHALL have `stopReason` `aborted`, the runner's signal SHALL be aborted, and the bridge SHALL have been closed

### Requirement: pnpm test:claude-code re-checks tool steps against the real claude
`pnpm test:claude-code` SHALL run, on the user's own logged-in `claude` and never in `pnpm test`, checks that tool steps' isolation matches `--safe-mode` (input tokens, and a project CLAUDE.md sentinel with a positive control), that a real tool call reaches the host, and that a durable run records its call. It SHALL skip, saying why, when `claude` is missing or not logged in.

#### Scenario: Tool-step isolation costs what safe mode costs
- **WHEN** the same question runs under `--safe-mode` and under the tool-step flags with a bridge serving no tools
- **THEN** their input tokens SHALL be within 10% plus 100 of each other

#### Scenario: A project CLAUDE.md does not reach a tool step
- **GIVEN** a directory whose `CLAUDE.md` names the codeword `PERIWINKLE-4417`, and plain `claude -p` there answering with it
- **WHEN** a one-tool step runs through the port in that directory, asked for any codeword
- **THEN** the answer SHALL NOT contain `PERIWINKLE-4417`

#### Scenario: A real claude calls a bridged tool
- **GIVEN** the port with `mcpBridge()` and a host whose `secret_number` answers `{ value: 4817 }`
- **WHEN** a step offering `secret_number` asks for the number
- **THEN** the host SHALL have been called once and the answer SHALL contain `4817`

#### Scenario: A real durable run records its call
- **WHEN** the durable bin runs the tools example on `--provider claude-code --model haiku --json`
- **THEN** it SHALL exit `0` with one `word_count` call recorded and `count` `6`

### Requirement: A tool step's environment also drops CLAUDE_CODE_SAFE_MODE
`toolStepEnv(parent)` SHALL return `claudeCodeEnv(parent)` without `CLAUDE_CODE_SAFE_MODE`, which an inherited `claude --safe-mode` session sets and which turns off `--mcp-config` servers. The port's tool steps and the provider's sessions SHALL spawn with it; steps without tools keep `claudeCodeEnv`. `CLAUDE_CODE_DISABLE_CLAUDE_MDS` and every other variable SHALL be kept.

#### Scenario: An inherited safe mode is dropped for a tool step
- **WHEN** `toolStepEnv({ PATH: "/bin", CLAUDE_CODE_SAFE_MODE: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDECODE: "1" })` is called
- **THEN** it SHALL return `{ PATH: "/bin", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" }`

#### Scenario: The port and the provider spawn tool steps with it
- **GIVEN** `process.env.CLAUDE_CODE_SAFE_MODE` set to `1`
- **WHEN** the port runs a tool step, and the provider starts a bridged session
- **THEN** neither runner's environment SHALL have `CLAUDE_CODE_SAFE_MODE`
- **AND** a step without tools through the port SHALL still be handed `CLAUDE_CODE_SAFE_MODE` unchanged

### Requirement: A signal stops the port's steps
`createClaudeCodeReasoningPort` SHALL take `signal?: AbortSignal`, passed to the runner it spawns with. When it is aborted before or during a step, `reason` SHALL resolve `{ kind: "failed", category: toFailureCategory("aborted"), message: "the claude-code step was aborted" }` without waiting for the process. Before a step, nothing is spawned and no bridge started. During a tool step, the bridge SHALL be closed before `reason` resolves.

#### Scenario: An aborted signal starts nothing
- **GIVEN** a port with a tool host, a fake bridge, a recording runner and an already aborted `signal`
- **WHEN** a request offering a tool is reasoned
- **THEN** the step SHALL fail with category `unrecognised` and a message containing `aborted`, and neither the runner nor the bridge SHALL have been called

#### Scenario: Aborting a text step kills claude
- **GIVEN** a port whose `binary` is a fake `claude` that records its pid and sleeps 30 s, and a `signal`
- **WHEN** the signal is aborted 100 ms into a text step
- **THEN** `reason` SHALL resolve failed with a message containing `aborted` within 2 s, and the recorded process SHALL no longer exist

#### Scenario: Aborting a tool step closes the bridge
- **GIVEN** a port with a tool host, a fake bridge, a runner that never resolves, and a `signal`
- **WHEN** the signal is aborted during a tool step
- **THEN** `reason` SHALL resolve failed with a message containing `aborted`, and the bridge SHALL have been closed

### Requirement: The bridge refuses calls once the step is aborted
After the port's `signal` aborts, the bridge handler SHALL answer every call `{ ok: false, text: "the claude-code step was aborted" }` without calling the host and without recording it.

#### Scenario: A call after the abort never reaches the host
- **GIVEN** a tool step whose runner keeps the bridge handler, and the port's `signal` aborted
- **WHEN** the handler is called with an offered tool and valid arguments
- **THEN** it SHALL answer `ok: false` with `aborted`, and the host SHALL not have been called
