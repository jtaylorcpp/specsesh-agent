## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: The stream argument is passed only to a listening run
The runner SHALL pass `reason` its second argument only when the run has a listener (`onEvent` or `streamRun`), and otherwise call `reason(request)` with one argument. A `StreamDelta` is `text_delta { delta }`, `thinking_delta { delta }`, `tool_call { name, inputs }` or `tool_result { name, ok, outputs }`. A delta reported after `reason` settles SHALL be dropped.

#### Scenario: An unlistened run passes one argument
- **WHEN** a script runs through `run` with no `onEvent`
- **THEN** every `reason` call SHALL receive exactly one argument

#### Scenario: A late delta is dropped
- **GIVEN** a port that reports a `text_delta` after its promise resolves
- **WHEN** the run is streamed
- **THEN** that delta SHALL NOT appear among the events
