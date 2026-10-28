## MODIFIED Requirements

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

## ADDED Requirements

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
