## MODIFIED Requirements

### Requirement: The Step Machine Is Exported From The Interpreter Entry
`@specsesh/agent/interpreter` SHALL export the functions `start`, `next`, `apply`, `run` and `hashSource`, the types `RunState`, `AwaitingStep`, `NextStep`, `StartOptions`, `RunOptions`, `RunResult` and `StepReport`, and the step-machine error classes. None of these functions SHALL write a file, open a network connection, read a credential or import a model client.

#### Scenario: Every step-machine export is reachable from the entry
- **WHEN** a consumer imports `start`, `next`, `apply`, `run`, `hashSource`, `SourceMismatchError` and `RunStateError` from `@specsesh/agent/interpreter`
- **THEN** each import SHALL resolve to a defined value

#### Scenario: A run does not touch the author's file
- **GIVEN** a script saved on disk whose run changes a variable
- **WHEN** the script's text is run to completion
- **THEN** the file on disk SHALL be byte-for-byte unchanged
- **AND** the result SHALL carry no `updatedSource` unless `persistVariables` was asked for
