## MODIFIED Requirements

### Requirement: One reason call is exactly one model request
`createPiReasoningPort({ models, model, ... })` SHALL return a `ReasoningPort`. Without a `tools` option, its `reason(request)` SHALL make exactly one model request, `models.complete(model, context, options)`, or `models.stream` with the same arguments when given a stream: it MUST NOT loop, run tools or feed a tool result back. `toOutcome` maps one message and never reports `cut-short`; only the tool loop can.

#### Scenario: A text-only step makes one request and completes
- **GIVEN** a faux provider answering `Hello.` and a one-subagent text-only script
- **WHEN** the script is run through the port
- **THEN** the provider SHALL receive exactly one request and the run SHALL end `completed`

#### Scenario: The port never reports cut-short
- **WHEN** any assistant message is mapped by `toOutcome`
- **THEN** the outcome's `kind` SHALL be `answered` or `failed`, never `cut-short`

## ADDED Requirements

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
