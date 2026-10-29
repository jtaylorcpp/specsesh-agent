# pi/port Specification

## Purpose
A `ReasoningPort` backed by pi-ai, so a script can run on any provider pi knows: one `reason()` call is one model request, mapped to a step outcome from structured fields only.

## Requirements

### Requirement: The pi adapter exports its port, mapping and model helpers
`@specsesh/agent/pi` SHALL export `createPiReasoningPort`, `forceTool`, `toOutcome`, `RESULT_TOOL`, `categoryFromStatus`, `DEFAULT_PROVIDER`, `DEFAULT_MODEL` and `resolveModel`, and nothing from the claude-code layer, which has its own entry (`pi/claude-code`). `RESULT_TOOL` MUST equal `"submit_result"`.

#### Scenario: The result tool name is stable
- **WHEN** a caller reads `RESULT_TOOL` from `@specsesh/agent/pi`
- **THEN** it SHALL equal `"submit_result"`

#### Scenario: The pi entry carries no claude-code exports
- **WHEN** a caller imports `@specsesh/agent/pi`
- **THEN** `createClaudeCodeReasoningPort` and `claudeCodeProvider` SHALL NOT be among its exports

### Requirement: One reason call is exactly one model request
`createPiReasoningPort({ models, model, ... })` SHALL return a `ReasoningPort`. Without a `tools` option, its `reason(request)` SHALL make exactly one model request, `models.complete(model, context, options)`, or `models.stream` with the same arguments when given a stream: it MUST NOT loop, run tools or feed a tool result back. `toOutcome` maps one message and never reports `cut-short`; only the tool loop can.

#### Scenario: A text-only step makes one request and completes
- **GIVEN** a faux provider answering `Hello.` and a one-subagent text-only script
- **WHEN** the script is run through the port
- **THEN** the provider SHALL receive exactly one request and the run SHALL end `completed`

#### Scenario: The port never reports cut-short
- **WHEN** any assistant message is mapped by `toOutcome`
- **THEN** the outcome's `kind` SHALL be `answered` or `failed`, never `cut-short`

### Requirement: The request context keeps system instructions as the system prompt
The port SHALL build the pi context as `{ systemPrompt: request.systemInstructions, messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }] }`. System instructions MUST NOT appear in the user message, and the prompt MUST be the only message.

#### Scenario: System instructions travel as the system prompt
- **GIVEN** a script whose `system.instructions` is `You triage support reports.`
- **WHEN** its first step is sent
- **THEN** the context's `systemPrompt` SHALL contain `You triage support reports.`
- **AND** the single user message SHALL NOT contain it

### Requirement: Request options default the output cap and pass the rest through
The port SHALL pass `maxTokens` as `options.maxTokens`, defaulting to `4096`. It SHALL pass `temperature` and `signal` only when given, and add the `forceTool(model)` options only when the request has an `outputSchema`. After each request it SHALL call `onMessage` with the raw assistant message, when given.

#### Scenario: The output cap passes through
- **GIVEN** a port created with `maxTokens: 123`
- **WHEN** a step is sent
- **THEN** the request options SHALL carry `maxTokens: 123`

#### Scenario: The default output cap is 4096
- **GIVEN** a port created without `maxTokens`
- **WHEN** a step is sent
- **THEN** the request options SHALL carry `maxTokens: 4096`

#### Scenario: onMessage sees every raw message
- **GIVEN** a port created with an `onMessage` callback
- **WHEN** a two-step script runs
- **THEN** the callback SHALL be called twice, each time with the provider's assistant message

### Requirement: A structured step offers exactly one result tool
When the request has an `outputSchema`, the context SHALL carry `tools` of exactly one tool: name `submit_result`, `parameters` equal to the `outputSchema` object as given, `constrainedSampling: { type: "json_schema", strict: "prefer" }`, and the description `Submit this step's result. Call this exactly once with every field filled; it is the only way the result is recorded.`. A text-only step MUST carry no `tools`.

#### Scenario: A structured step offers the result tool
- **GIVEN** a step whose request carries an `outputSchema`
- **WHEN** it is sent
- **THEN** `context.tools` SHALL be one tool named `submit_result` whose `parameters` is that schema

#### Scenario: A text-only step offers no tools
- **WHEN** a step without `outputSchema` is sent
- **THEN** the context SHALL have no `tools` property

### Requirement: forceTool names the result tool per wire API
`forceTool(model)` SHALL return provider options that force `submit_result`, chosen by `model.api`, because pi's neutral `toolChoice` offers only `auto` and `none`. Anthropic and Bedrock force the tool by name, OpenAI chat completions and responses (and Azure responses) force the named function, Google and Mistral require some tool, and any API not listed MUST get `{}`, leaving the provider's default and the tool description.

#### Scenario: Anthropic forces the tool by name
- **WHEN** `forceTool` is called with the anthropic `claude-haiku-4-5` model
- **THEN** it SHALL return `{ toolChoice: { type: "tool", name: "submit_result" } }`

#### Scenario: Bedrock forces the tool by name
- **WHEN** `forceTool` is called with a model whose `api` is `bedrock-converse-stream`
- **THEN** it SHALL return `{ toolChoice: { type: "tool", name: "submit_result" } }`

#### Scenario: OpenAI chat completions force the named function
- **WHEN** `forceTool` is called with `api` `openai-completions`
- **THEN** it SHALL return `{ toolChoice: { type: "function", function: { name: "submit_result" } } }`

#### Scenario: OpenAI and Azure responses force the function by name
- **WHEN** `forceTool` is called with `api` `openai-responses` or `azure-openai-responses`
- **THEN** it SHALL return `{ toolChoice: { type: "function", name: "submit_result" } }`

#### Scenario: Google and Mistral require some tool
- **WHEN** `forceTool` is called with `api` `google-generative-ai`, `google-vertex` or `mistral-conversations`
- **THEN** it SHALL return `{ toolChoice: "any" }`

#### Scenario: An unlisted API is left at its default
- **WHEN** `forceTool` is called with `api` `pi-messages`
- **THEN** it SHALL return `{}`

### Requirement: A stop or tool-use message is answered
`toOutcome(message, wantsStructured)` SHALL map `stopReason` `stop` or `toolUse` to `answered`, with `text` equal to the message's text blocks joined with `""`. When `wantsStructured` is true and the content holds a `toolCall` named `submit_result`, `structured` SHALL be that call's `arguments`; otherwise the outcome MUST carry no `structured`, and the interpreter decides that is a failure.

#### Scenario: The result tool's arguments become the structured result
- **GIVEN** a structured step answered with a `submit_result` call carrying `{ severity: "high", urgent: true }`
- **WHEN** the run applies it
- **THEN** the run SHALL set `severity` to `"high"` and `urgent` to `true`

#### Scenario: Text only on a structured step carries no structured result
- **GIVEN** a structured step answered with text and no tool call
- **WHEN** it is mapped
- **THEN** the outcome SHALL be `answered` without `structured`, and the run SHALL end `failed`

#### Scenario: A text step ignores any tool call
- **WHEN** a message with `stopReason` `toolUse` and a `submit_result` call is mapped with `wantsStructured` false
- **THEN** the outcome SHALL be `answered` with no `structured`

### Requirement: Length, abort and error stops are failures with a structured category
`toOutcome(message, wantsStructured, status?)` SHALL map `length` to `failed` / `max_output_tokens`, message defaulting to `the model hit its output token limit`; `aborted` to `failed` / `unrecognised` (via `toFailureCategory("aborted")`), message defaulting to `the request was aborted`; and every other `stopReason` to `failed` with the category `categoryFromStatus` gives the first diagnostic `error.code`, else `status`. The message MUST be `errorMessage` when present.

#### Scenario: A length stop is never answered
- **WHEN** a message with `stopReason` `length` is mapped
- **THEN** the outcome SHALL be `failed` with category `max_output_tokens`

#### Scenario: An abort is unrecognised with its message kept
- **WHEN** a message with `stopReason` `aborted` and `errorMessage` `user cancelled` is mapped
- **THEN** the outcome SHALL be `{ kind: "failed", category: "unrecognised", message: "user cancelled" }`

#### Scenario: The category comes from the status, not the message
- **GIVEN** an error message whose text says `rate limit` and whose diagnostic code is `402`
- **WHEN** it is mapped
- **THEN** the category SHALL be `billing_error`

#### Scenario: No status means unknown
- **WHEN** an error message with no diagnostic code is mapped with no status
- **THEN** the category SHALL be `unknown`

#### Scenario: An error with no message names its stop reason
- **WHEN** a message with `stopReason` `error` and no `errorMessage` is mapped
- **THEN** the message SHALL be `the request ended with stopReason "error"`

#### Scenario: A given status maps when diagnostics carry none
- **WHEN** an error message with no diagnostic code is mapped with status `429`
- **THEN** the category SHALL be `rate_limit`

#### Scenario: The diagnostic code wins over the given status
- **WHEN** an error message whose diagnostic code is `402` is mapped with status `429`
- **THEN** the category SHALL be `billing_error`

### Requirement: categoryFromStatus maps HTTP statuses only
`categoryFromStatus(code)` SHALL read a number, or a string parsed as a base-10 integer, and return: `401`/`403` → `authentication_failed`; `402` → `billing_error`; `404` → `model_not_found`; `429` → `rate_limit`; `529`/`503` → `overloaded`; `400`/`413`/`422` → `invalid_request`; any other `500`–`599` → `server_error`. Anything else, including no code and non-numeric strings, MUST return `undefined`.

#### Scenario: Each mapped status
- **WHEN** `categoryFromStatus` is called with `401`, `403`, `402`, `404`, `429`, `529`, `503`, `400`, `413`, `422`, `500` and `"502"`
- **THEN** it SHALL return `authentication_failed`, `authentication_failed`, `billing_error`, `model_not_found`, `rate_limit`, `overloaded`, `overloaded`, `invalid_request`, `invalid_request`, `invalid_request`, `server_error` and `server_error`

#### Scenario: Unmapped values have no category
- **WHEN** it is called with `undefined`, `200`, `418`, `"ECONNRESET"` or `""`
- **THEN** it SHALL return `undefined`

### Requirement: The testing default is Claude Haiku on Anthropic
`DEFAULT_PROVIDER` SHALL equal `"anthropic"` and `DEFAULT_MODEL` SHALL equal `"claude-haiku-4-5"`.

#### Scenario: The defaults
- **WHEN** a caller reads the defaults
- **THEN** they SHALL be `"anthropic"` and `"claude-haiku-4-5"`

### Requirement: resolveModel fails by name instead of returning undefined
`resolveModel(models, provider, id)` SHALL return `models.getModel(provider, id)` when it exists, and otherwise throw `UnknownModelError` (`name` `"UnknownModelError"`) with message `no model "<id>" on provider "<provider>".` followed by ` Known <provider> models include: <up to 12 ids, comma-separated>.` when the provider has models, else ` "<provider>" is not a registered provider.`.

#### Scenario: The default testing model resolves
- **WHEN** `resolveModel(builtinModels(), "anthropic", "claude-haiku-4-5")` is called
- **THEN** it SHALL return a model whose `api` is `anthropic-messages`

#### Scenario: An unknown model lists real ones
- **WHEN** it is called for `claude-nope` on `anthropic`
- **THEN** it SHALL throw a message containing `no model "claude-nope"` and `Known anthropic models include:`
- **AND** the list SHALL hold at most 12 ids

#### Scenario: An unknown provider says so
- **WHEN** it is called for provider `nowhere`
- **THEN** it SHALL throw a message containing `"nowhere" is not a registered provider.`

### Requirement: A port given a tool host runs offered tools in a loop
With `tools` (a `PiToolHost`, `(call: { name, tool, inputs }) => ActionResult`, sync or async), a request offering tools SHALL run a loop. Each request offers every `ToolOffer` as a pi tool (`parameters` its `inputSchema`), plus `submit_result` on a structured step, unforced. Each reply's tool calls are handled in order, each result fed back as a `toolResult` message. A reply with no tool call, or one calling `submit_result`, ends the loop.

#### Scenario: A tool call runs on the host and its result reaches the model
- **GIVEN** a port with a tool host answering `{ ok: true, outputs: { content: "hi" } }`, and a step offering `read`
- **WHEN** the model calls `read`, then answers `Done.`
- **THEN** the host SHALL be called once, with `name` `read` and the offer's `tool`
- **AND** the second request SHALL carry a `toolResult` for that call whose text is `{"content":"hi"}`
- **AND** the outcome SHALL be `answered` with text `Done.`

#### Scenario: A step's tool calls are recorded in call order
- **GIVEN** a step offering `read` and `note`
- **WHEN** the model calls `read`, then `note`, then answers
- **THEN** `toolCalls` SHALL name `read` then `note`, each with its inputs, `ok` and outputs

#### Scenario: A set on a reasoning action applies from the loop
- **GIVEN** a script whose reasoning action `read` sets `@variables.content = @outputs.content`, run through `run()` with this port
- **WHEN** the model calls `read` and the host answers `content` `hi`
- **THEN** the run SHALL end `completed` with `content` `"hi"`

#### Scenario: A request with tools and no tool host is still refused
- **GIVEN** a port created without `tools`
- **WHEN** a request offering tools is sent
- **THEN** it SHALL resolve failed with category `invalid_request` and no model request SHALL be made

### Requirement: A call is checked against its offer and its bound inputs merged
Before the host runs a call, its arguments SHALL be checked against the offer's `inputSchema`: required present, no extra key, each JSON type matching. A failing call MUST NOT reach the host: the model gets an error result naming each problem, and it is recorded `ok: false`, `outputs: {}`. A passing call's `inputs` SHALL be its arguments overlaid with the offer's `bound`, bound winning.

#### Scenario: Bound inputs override the model's arguments
- **GIVEN** an offer of `edit` with `bound` `{ path: "a.txt" }` and `content` left to the model
- **WHEN** the model calls `edit` with `{ content: "x", path: "b.txt" }`
- **THEN** the host SHALL receive inputs `{ content: "x", path: "a.txt" }`

#### Scenario: A call with a wrong type never reaches the host
- **GIVEN** an offer whose input `count` is a number
- **WHEN** the model calls it with `count` `"three"`
- **THEN** the host SHALL NOT be called, the model SHALL get an error result naming `count`
- **AND** the call SHALL be recorded with `ok` `false` and `outputs` `{}`

### Requirement: A failed or unknown call is answered to the model as an error
A host result `{ ok: false, message }`, or a host that throws, SHALL be fed back with `isError: true` and the message as text, and recorded `ok: false`, `outputs: {}`. A call naming neither an offer nor `submit_result` SHALL get the error result `no tool named "<name>" is offered on this step`, MUST NOT reach the host, and MUST NOT be recorded.

#### Scenario: A host failure is fed back and the loop goes on
- **GIVEN** a tool host that throws `disk full`
- **WHEN** the model calls the offered tool, then answers `Sorry.`
- **THEN** the second request SHALL carry an error result containing `disk full`
- **AND** the outcome SHALL be `answered`, its one tool call `ok` `false`

#### Scenario: An unoffered tool name is not recorded
- **WHEN** the model calls `delete` on a step offering only `read`, then answers
- **THEN** it SHALL get an error result naming `delete`, the host SHALL NOT be called
- **AND** `toolCalls` SHALL NOT name `delete`, and the run SHALL NOT fail because of it

### Requirement: A structured step ends on submit_result or one forced settling request
On a structured step, a `submit_result` call SHALL end the loop after that reply's other calls run, and its arguments SHALL be `structured`. If the model stops without calling it, the port SHALL make one more request offering only `submit_result`, with `forceTool(model)`, and map that reply with `toOutcome`, keeping the calls already recorded.

#### Scenario: submit_result after a tool call ends the step
- **GIVEN** a structured step offering `read`
- **WHEN** the model calls `read`, then `submit_result` with `{ summary: "ok" }`
- **THEN** the outcome SHALL be `answered` with `structured` `{ summary: "ok" }` and one tool call

#### Scenario: A model that stops without a result is asked once, forced
- **GIVEN** a structured step offering `read`
- **WHEN** the model calls `read`, then answers with text only
- **THEN** one more request SHALL be made offering only `submit_result`, with the forced tool options
- **AND** its `submit_result` arguments SHALL be the outcome's `structured`

### Requirement: maxRounds bounds a step's model requests
`maxRounds` SHALL default to `16` and count every model request a step makes, the settling request included. A step that reaches it while the model still calls tools SHALL end `{ kind: "cut-short", text, turns: maxRounds, toolCalls }`. A reply whose `stopReason` is `length`, `aborted` or `error` SHALL end the step with `toOutcome`'s failure plus the step's `toolCalls`. `onMessage` SHALL see every reply.

#### Scenario: A model that never stops calling tools is cut short
- **GIVEN** a port with `maxRounds: 3` and a model that calls a tool on every reply
- **WHEN** the step runs
- **THEN** exactly 3 requests SHALL be made and the outcome SHALL be `cut-short` with `turns` `3` and three `toolCalls`

#### Scenario: An error reply mid-loop fails the step
- **WHEN** the model's second reply has `stopReason` `error` and diagnostic code `429`
- **THEN** the outcome SHALL be `failed` with category `rate_limit`
- **AND** its `toolCalls` SHALL hold the call the first reply made

### Requirement: A streamed request forwards text and thinking deltas
Given a stream, every request the port makes SHALL use `models.stream()` and forward each `text_delta` and `thinking_delta` to `onDelta`, then map `await result()` with `toOutcome`. A streamed step's outcome SHALL equal the outcome of the same step unstreamed. `toolcall_delta` MUST NOT be forwarded. Without a stream the port SHALL call `complete()`.

#### Scenario: Deltas concatenate to the step's text
- **GIVEN** a faux provider streaming `Hello there.` in several deltas
- **WHEN** a one-step script runs through `streamRun`
- **THEN** the step's `text_delta`s joined SHALL equal its outcome's text

#### Scenario: Streamed and unstreamed runs agree
- **WHEN** the same structured script runs once through `run` and once through `streamRun` on the same faux replies
- **THEN** both results SHALL be equal

#### Scenario: An unstreamed step never calls stream
- **WHEN** a script runs through `run` with no `onEvent`
- **THEN** the provider SHALL be called through `complete()` only

### Requirement: The tool loop reports each call and its result
In a streamed tool loop, the port SHALL report `tool_call { name, inputs }` (inputs merged with `bound`) before the host runs a call and `tool_result { name, ok, outputs }` after. A call refused by the argument check SHALL report only `tool_result` with `ok` `false`. `submit_result` and an unoffered name SHALL report nothing.

#### Scenario: A tool call is reported around its execution
- **GIVEN** a step offering `read`, and a model that calls it, then answers
- **WHEN** the run is streamed
- **THEN** the events SHALL include `tool_call` for `read`, then `tool_result` with its outputs, before `step_end`

### Requirement: The port records each response's HTTP status
For every model request, the port SHALL pass pi a `fetch` that calls `globalThis.fetch` and keeps the status of the response, and SHALL map the message with that status. This covers a one-shot step, every tool-loop round and the settling request, streamed or not. On `google-generative-ai` and `google-vertex` models the port MUST pass no `fetch`.

#### Scenario: A 429 on the Anthropic wire is a rate limit
- **GIVEN** an `anthropic` model pointed at a server answering `429`
- **WHEN** a step runs through the port
- **THEN** it SHALL fail with category `rate_limit`

#### Scenario: A 401 on the OpenAI wire is an authentication failure
- **GIVEN** an `openai` model pointed at a server answering `401`
- **WHEN** a step runs through the port
- **THEN** it SHALL fail with category `authentication_failed`

#### Scenario: A 500 from Ollama is a server error
- **GIVEN** an `ollamaProvider` model pointed at a server answering `500`
- **WHEN** a step runs through the port
- **THEN** it SHALL fail with category `server_error`

#### Scenario: A tool-loop round keeps its status
- **GIVEN** a port with a tool host, and a server answering `429`
- **WHEN** a step offering a tool runs
- **THEN** it SHALL fail with category `rate_limit`

#### Scenario: A streamed step keeps its status
- **GIVEN** a server answering `429`
- **WHEN** a step runs through the port with a stream
- **THEN** it SHALL fail with category `rate_limit`
