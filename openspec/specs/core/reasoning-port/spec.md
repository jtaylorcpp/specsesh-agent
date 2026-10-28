# core/reasoning-port Specification

## Purpose
The single injected boundary a reasoning step leaves through: a stateless request with its own system channel, three possible outcomes, and a failure vocabulary that never guesses.

## Requirements

### Requirement: One reasoning step leaves through one injected port
The interpreter SHALL send every reasoning step through a caller-supplied `ReasoningPort`, exported from `@specsesh/agent/interpreter`, which has exactly one method: `reason(request: ReasoningRequest, stream?: { onDelta(delta: StreamDelta): void }): Promise<StepOutcome>`. The runner SHALL call `reason` once per dispatched step. `src/authoring/` and `src/interpreter/` SHALL hold exactly one `.reason(` call site, in `src/interpreter/run.ts`.

#### Scenario: A reasoning step runs through the injected port
- **GIVEN** a document with one subagent holding a prompt line
- **WHEN** it is run with a recording port
- **THEN** the port SHALL receive exactly one request
- **AND** the result's single step SHALL carry that request and the port's outcome

#### Scenario: A port that ignores the stream still runs
- **GIVEN** a port whose `reason` takes one parameter
- **WHEN** a script runs through `streamRun` with it
- **THEN** the run SHALL complete with `step_start`, `step_end` and `run_end` events and no deltas

### Requirement: There is no default port
The interpreter SHALL construct no default port. `run` with no `port` SHALL reject with `NoReasoningPortError` before parsing or dispatching anything. The error's `name` SHALL be `"NoReasoningPortError"`, its message SHALL begin `no reasoning port was provided`, say that the package constructs no default, and name the package as `@specsesh/agent`, never `@coopcli/agentscript`.

#### Scenario: No port is injected
- **WHEN** `run(source)` is called with no `port`
- **THEN** it SHALL reject with `NoReasoningPortError`
- **AND** nothing SHALL be dispatched

#### Scenario: No port is refused before the document is read
- **WHEN** `run` is called with no `port` and an unparsable source
- **THEN** it SHALL reject with `NoReasoningPortError`, not a document error

#### Scenario: The message names the published package
- **WHEN** a `NoReasoningPortError` is constructed
- **THEN** its message SHALL contain `@specsesh/agent declares the port`
- **AND** it SHALL NOT contain `@coopcli`

### Requirement: A request has exactly three fields
Each dispatched `ReasoningRequest` SHALL hold `systemInstructions` (string), `prompt` (string), `outputSchema` (a JSON Schema object) only for a step that writes variables from its result, and `tools` (a non-empty `ToolOffer[]`) only for a step with reasoning actions. No other key SHALL be present. The type SHALL hold no executor or turn bound: `tools` are declarations, and the interpreter SHALL execute no tool and count no rounds.

#### Scenario: Only the three fields cross the boundary
- **WHEN** a plain step and a structured step are dispatched
- **THEN** every key of every request SHALL be one of `systemInstructions`, `prompt`, `outputSchema` or `tools`
- **AND** the plain step's request SHALL have no `outputSchema`
- **AND** neither request SHALL have a `tools` key, because neither step has reasoning actions

#### Scenario: A step with reasoning actions offers tools
- **GIVEN** the default task script's `act` subagent
- **WHEN** its request is dispatched
- **THEN** it SHALL carry `tools` naming `read`, `edit` and `shell`, in that order, and no `outputSchema`

### Requirement: The port is stateless
Every request SHALL carry the full system instructions and its own full composed prompt. Nothing SHALL assume the port retained anything from an earlier step.

#### Scenario: The port remembers nothing
- **GIVEN** a document with two subagents, each with a prompt line
- **WHEN** it is run with both as entries
- **THEN** the second request SHALL carry the same full `systemInstructions` as the first
- **AND** its `prompt` SHALL be the second subagent's composed prompt in full

### Requirement: A step ends answered, cut short, or failed
`StepOutcome` SHALL be a union on `kind` with exactly three members: `{ kind: "answered", text, structured?, toolCalls? }`, where `structured` is present only when the step asked for one and `toolCalls` only when it offered tools (see "An answer records its tool calls"); `{ kind: "cut-short", text, turns }`, where `turns` is the implementation's own count; and `{ kind: "failed", category, message }`, where `message` is the layer's own words, verbatim.

#### Scenario: The implementation reports a step stopped at its bound
- **WHEN** the port answers `{ kind: "cut-short", text: "partial", turns: 7 }`
- **THEN** the step's outcome SHALL be that object, with `turns` 7
- **AND** the run's `kind` SHALL be `cut-short`

#### Scenario: An answer records the tools it called
- **WHEN** a step offering `shell` is answered after two calls to it
- **THEN** `toolCalls` SHALL hold two entries named `shell`, in call order, each with its `inputs`, `ok` and `outputs`

### Requirement: A run's kind comes from its last step
A run's `kind` SHALL be `completed` when every dispatched step answered and every action call succeeded, or nothing was dispatched. Otherwise it SHALL be the last step's `cut-short` or `failed`, or `failed` for a failed action call, because either ends the run. The interpreter SHALL impose no bound of its own and pass none to the port.

#### Scenario: A failed step ends the run
- **GIVEN** two entries
- **WHEN** the first step fails
- **THEN** the run's `kind` SHALL be `failed` and the second SHALL NOT be dispatched

#### Scenario: The interpreter imposes no bound of its own
- **WHEN** a run dispatches steps
- **THEN** no request SHALL carry a turn or round limit, and the runner SHALL keep no count of its own

#### Scenario: A failed action call ends the run
- **GIVEN** two entries, the first a deterministic subagent whose call fails
- **WHEN** the run proceeds
- **THEN** the run's `kind` SHALL be `failed` and the second entry SHALL NOT be reached

### Requirement: Failure categories are a closed set of twelve
`FailureCategory` SHALL be exactly twelve strings: the nine a layer names (`authentication_failed`, `oauth_org_not_allowed`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`), plus `layer_unknown` (the layer said "unknown"), `unrecognised` (a category outside this set) and `unknown` (no category reported).

#### Scenario: Every category round-trips through a run
- **WHEN** the port fails once with each of the twelve categories
- **THEN** each recorded category SHALL be one of the twelve and equal to the one reported

### Requirement: The known layer vocabulary is exported
`KNOWN_FAILURE_CATEGORIES` SHALL list exactly the ten layer strings this runtime can map, in this order: the nine layer names, then `unknown`, the layer's own spelling, which maps to `layer_unknown`.

#### Scenario: The exported vocabulary
- **WHEN** `KNOWN_FAILURE_CATEGORIES` is read
- **THEN** it SHALL equal `["authentication_failed", "oauth_org_not_allowed", "billing_error", "rate_limit", "overloaded", "invalid_request", "model_not_found", "server_error", "max_output_tokens", "unknown"]`

### Requirement: A layer's reported category is mapped, never guessed
`toFailureCategory(reported)` SHALL map each of the nine layer names to itself and `"unknown"` to `layer_unknown`. It SHALL map `undefined`, `null` and `""` to `unknown`, and every other string, near-misses and other casings included, to `unrecognised`. No string SHALL map to a named category other than its own.

#### Scenario: Every category the layer reports has a name here
- **WHEN** `toFailureCategory` is called with each of the nine layer names
- **THEN** each SHALL return itself, and none SHALL return `unrecognised`

#### Scenario: The layer saying unknown and the layer saying nothing are different facts
- **WHEN** `toFailureCategory("unknown")` and `toFailureCategory(undefined)` are called
- **THEN** they SHALL return `layer_unknown` and `unknown` respectively

#### Scenario: Empty and null report nothing
- **WHEN** `toFailureCategory("")` and `toFailureCategory(null)` are called
- **THEN** both SHALL return `unknown`

#### Scenario: A category from some other layer stays unrecognised
- **WHEN** `toFailureCategory("quota_exceeded")` or `toFailureCategory("Rate_Limit")` is called
- **THEN** it SHALL return `unrecognised`

### Requirement: Our own categories are recognisable
`isFailureCategory(value)` SHALL return `true` exactly when `value` is one of the twelve `FailureCategory` strings, and `false` for every other string, including `""`.

#### Scenario: Membership
- **WHEN** `isFailureCategory` is called with `rate_limit`, `layer_unknown`, `unrecognised` and `unknown`
- **THEN** each SHALL return `true`
- **AND** `isFailureCategory("aborted")` SHALL return `false`

### Requirement: A port's return value is never trusted to be well-formed
The runner SHALL normalise whatever `reason` resolves to before recording it, and SHALL never throw because of it. A value that is `null` or not an object SHALL settle as `failed`, category `unknown`, with a message `the port returned null` (or `the port returned <typeof>`) that says `rather than an outcome`. A rejected `reason` promise SHALL propagate out of `run`.

#### Scenario: A port that answers nothing at all
- **WHEN** the port resolves `null`
- **THEN** the run SHALL resolve with a `failed` step and SHALL NOT throw a `TypeError`

#### Scenario: A port that answers a string
- **WHEN** the port resolves `"ok"`
- **THEN** the step SHALL be `failed` with a message beginning `the port returned string`

### Requirement: An unknown outcome kind is a failure
An object whose `kind` is `"answered"` or `"cut-short"` SHALL be recorded as given, with no further field checks. Any other `kind`, including a missing one, SHALL settle as `failed`, category `unknown`, with a message containing `an outcome kind this runtime does not know` and the JSON of the reported kind.

#### Scenario: A kind the set does not name
- **WHEN** the port answers `{ kind: "exploded" }`
- **THEN** the step SHALL be `failed` with category `unknown` and a message naming `"exploded"`
- **AND** the run's `kind` SHALL be `failed`, not a fourth value

### Requirement: A reported failure keeps our category and its message
For `kind: "failed"`, a `category` already in `FailureCategory` SHALL be kept unchanged, including `unknown`, which SHALL never become `layer_unknown`. A foreign string SHALL pass through `toFailureCategory`, and a missing or non-string one SHALL become `unknown`. A string `message` SHALL be kept verbatim. A non-string one SHALL become `the port reported a failure with no message`.

#### Scenario: An exhausted rate limit keeps its category
- **WHEN** the port answers `{ kind: "failed", category: "rate_limit", message: "429 Too Many Requests" }`
- **THEN** the step SHALL carry category `rate_limit` and that message verbatim

#### Scenario: A port's own unknown stays unknown
- **WHEN** the port answers `{ kind: "failed", category: "unknown", message: "m" }`
- **THEN** the recorded category SHALL be `unknown`, not `layer_unknown`

#### Scenario: A foreign category is normalised
- **WHEN** the port answers `{ kind: "failed", category: "quota_exceeded", message: "m" }`
- **THEN** the recorded category SHALL be `unrecognised` and the message `m`

#### Scenario: A failure with no message
- **WHEN** the port answers `{ kind: "failed", category: "rate_limit" }`
- **THEN** the step SHALL be `failed`, category `rate_limit`, message `the port reported a failure with no message`

### Requirement: The core package reaches no model on its own
No required dependency of `@specsesh/agent` SHALL be a model SDK (a name matching `anthropic`, `openai`, `@google/gen`, `bedrock`, `langchain`, `@ai-sdk`, `ollama` or `claude-code`), and no file in `src/authoring/` or `src/interpreter/` SHALL import one, contain an `http(s)://` literal, call `fetch(`, construct a `WebSocket` or `XMLHttpRequest`, read `process.env`, or mention an API key or bearer token.

#### Scenario: The package imports no model client
- **WHEN** the manifest's `dependencies` and every `.ts` file under `src/authoring/`, `src/interpreter/` and `__tests__/core/` are scanned
- **THEN** no dependency or import SHALL match a model-client name
- **AND** no file under `src/authoring/` or `src/interpreter/` SHALL construct an endpoint, make a network call or read a credential

### Requirement: The core package imports only what it declares
Every import in `src/authoring/`, `src/interpreter/` and `__tests__/core/` SHALL resolve to a declared dependency or dev dependency, a Node built-in, or a relative path inside those directories.

#### Scenario: Imports stay inside the declared graph
- **WHEN** every import specifier under `src/authoring/`, `src/interpreter/` and `__tests__/core/` is resolved
- **THEN** each SHALL be a declared dependency, a `node:` built-in or a relative path inside those directories

### Requirement: A tool offer declares, and never executes
`ToolOffer` SHALL be `{ name, description, inputSchema, action, bound }` (`core/composition`). The core SHALL never call a tool: it offers declarations and reads back `toolCalls` only to apply outputs. A recorded call naming a tool the request did not offer SHALL make the step failed, with category `unknown`.

#### Scenario: An unoffered tool call fails the step
- **GIVEN** a step offering only `edit`
- **WHEN** it is answered with a `toolCalls` entry named `delete`
- **THEN** the step SHALL be failed, naming `delete`, and nothing SHALL be set from it

### Requirement: An answer records its tool calls
An answered step that offered tools SHALL carry `toolCalls`: one `{ name, inputs, ok, outputs, record? }` per call, in call order. `ok` SHALL be `false` for a refused, failed or interrupted call, whose `outputs` are `{}`; `record` is the host's opaque `Action`/`Evidence` record, carried through unchanged.

#### Scenario: A refused call is recorded as not ok
- **GIVEN** a step offering `shell`
- **WHEN** the host refuses a call to it
- **THEN** its `toolCalls` entry SHALL have `ok` `false` and `outputs` `{}`

### Requirement: A port that cannot run tools refuses a request that offers them
A port that cannot run a tool loop SHALL answer any request carrying `tools` with `{ kind: "failed", category: "invalid_request" }` and the `TOOLS_NEED_DURABLE_HOST` message, which names the durable host, a pi port given a tool host, and a claude-code port given tools and a bridge, without contacting a model. The pi and claude-code ports created without `tools` are such ports.

#### Scenario: The pi port refuses a tool request
- **GIVEN** the pi reasoning port created without `tools`, and a request with `tools`
- **WHEN** `reason` is called
- **THEN** it SHALL resolve failed with category `invalid_request`, and no model request SHALL be made
- **AND** the message SHALL contain `durable host` and `tool host`

#### Scenario: The claude-code port without tools refuses a tool request
- **GIVEN** the claude-code reasoning port created without `tools`, and a request with `tools`
- **WHEN** `reason` is called
- **THEN** it SHALL resolve failed with category `invalid_request` and a message containing `claude-code port given tools`, and the runner SHALL not have been called

### Requirement: The stream argument is passed only to a listening run
The runner SHALL pass `reason` its second argument only when the run has a listener (`onEvent` or `streamRun`), and otherwise call `reason(request)` with one argument. A `StreamDelta` is `text_delta { delta }`, `thinking_delta { delta }`, `tool_call { name, inputs }` or `tool_result { name, ok, outputs }`. A delta reported after `reason` settles SHALL be dropped.

#### Scenario: An unlistened run passes one argument
- **WHEN** a script runs through `run` with no `onEvent`
- **THEN** every `reason` call SHALL receive exactly one argument

#### Scenario: A late delta is dropped
- **GIVEN** a port that reports a `text_delta` after its promise resolves
- **WHEN** the run is streamed
- **THEN** that delta SHALL NOT appear among the events
