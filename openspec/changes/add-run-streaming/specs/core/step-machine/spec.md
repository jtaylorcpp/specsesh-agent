## ADDED Requirements

### Requirement: run reports its progress as RunEvents to onEvent
`run(source, { onEvent })` SHALL call `onEvent` synchronously, in order, with each `RunEvent`: per step `step_start`, the port's deltas tagged with `step` and `subagent`, then `step_end { outcome }`; per `run` call `action_start` then `action_end`; and `run_end { result }` last. Every event SHALL be JSON-serialisable. A listener that throws MUST NOT change the run, and later events SHALL still be delivered.

#### Scenario: A two-step run reports its steps in order
- **GIVEN** a recording port and a two-step script
- **WHEN** it runs with `onEvent`
- **THEN** the event types SHALL be `step_start`, `step_end`, `step_start`, `step_end`, `run_end`, with `step` `0` then `1`
- **AND** `run_end`'s `result` SHALL equal the value `run` resolves

#### Scenario: Deltas sit between their step's boundaries
- **GIVEN** a port that reports `text_delta`s `Hel` and `lo.` and answers `Hello.`
- **WHEN** the run is streamed
- **THEN** both deltas SHALL come after that step's `step_start` and before its `step_end`, tagged with its `step`

#### Scenario: A run statement reports its action
- **GIVEN** a deterministic subagent that runs `@actions.echo`
- **WHEN** it runs with `onEvent` and an `actionHost`
- **THEN** `action_start` and then `action_end` SHALL name `echo`, the latter with its `ok` and outputs

#### Scenario: A throwing listener changes nothing
- **GIVEN** an `onEvent` that throws on every call
- **WHEN** a script runs
- **THEN** its result SHALL equal the same run without `onEvent`

### Requirement: streamRun yields a run's events and its result
`streamRun(source, options)` SHALL start the run immediately and return an async iterable of every `RunEvent` and a `result` promise that settles as `run` would. Events SHALL be buffered so none is lost to a slow reader; iteration ends after `run_end`, or rethrows the run's rejection after the buffered events. A second iteration SHALL throw.

#### Scenario: for await sees every event, then the result
- **WHEN** a two-step script is consumed with `for await (const e of streamRun(...))`, reading slowly
- **THEN** it SHALL see all five events, and `await stream.result` SHALL equal `run`'s result

#### Scenario: A refused start rejects the iterator and the result
- **WHEN** `streamRun` is given a document `start` refuses
- **THEN** the iterator SHALL throw that error and `result` SHALL reject with it

#### Scenario: A stream iterates once
- **WHEN** a second `for await` begins on the same stream
- **THEN** it SHALL throw
