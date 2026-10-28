## MODIFIED Requirements

### Requirement: The provider refuses more than one pi tool without spawning
Without a `bridge` option, a request offering more than one tool SHALL end as an error message, with no process spawned, whose `errorMessage` is `the claude-code provider runs at most one pi tool per request without a bridge; this one offered <n> (<names, comma-separated>)`.

#### Scenario: Two tools are refused
- **WHEN** a request offering tools `a` and `b` is completed by a provider without `bridge`
- **THEN** the message SHALL have `stopReason` `error`, an `errorMessage` matching `at most one pi tool` and `without a bridge`, and naming `a, b`
- **AND** the runner SHALL not have been called

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

## ADDED Requirements

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
