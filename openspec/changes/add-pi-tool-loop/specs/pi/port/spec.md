## MODIFIED Requirements

### Requirement: One reason call is exactly one model request
`createPiReasoningPort({ models, model, ... })` SHALL return a `ReasoningPort`. Without a `tools` option, its `reason(request)` SHALL make exactly one `models.complete(model, context, options)` call and no other model call: it MUST NOT loop, run tools or feed a tool result back. `toOutcome` maps one message and never reports `cut-short`; only the tool loop can.

#### Scenario: A text-only step makes one request and completes
- **GIVEN** a faux provider answering `Hello.` and a one-subagent text-only script
- **WHEN** the script is run through the port
- **THEN** the provider SHALL receive exactly one request and the run SHALL end `completed`

#### Scenario: The port never reports cut-short
- **WHEN** any assistant message is mapped by `toOutcome`
- **THEN** the outcome's `kind` SHALL be `answered` or `failed`, never `cut-short`

## ADDED Requirements

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
`maxRounds` SHALL default to `16` and count every model request a step makes, the settling request included. A step that reaches it while the model still calls tools SHALL end `{ kind: "cut-short", text, turns: maxRounds }`. A reply whose `stopReason` is `length`, `aborted` or `error` SHALL end the step with `toOutcome`'s failure. `onMessage` SHALL see every reply.

#### Scenario: A model that never stops calling tools is cut short
- **GIVEN** a port with `maxRounds: 3` and a model that calls a tool on every reply
- **WHEN** the step runs
- **THEN** exactly 3 requests SHALL be made and the outcome SHALL be `cut-short` with `turns` `3`

#### Scenario: An error reply mid-loop fails the step
- **WHEN** the model's second reply has `stopReason` `error` and diagnostic code `429`
- **THEN** the outcome SHALL be `failed` with category `rate_limit`
