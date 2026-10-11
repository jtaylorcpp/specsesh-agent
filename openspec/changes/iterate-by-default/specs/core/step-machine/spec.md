## MODIFIED Requirements

### Requirement: Every Error Names Itself
Each step-machine error — `SourceMismatchError`, `RunStateError`, `UnparsedDocumentError`, `UnreadableDocumentError`, `NoEntrySubagentError`, `UnknownSubagentError`, `UndeclaredOverrideError`, `InvalidChoicesError`, `EmptyPromptError` — SHALL be exported, SHALL extend `Error`, and SHALL set `name` to its class name, so a caller tells refusals apart without reading the message.

#### Scenario: A refusal is identifiable by class and name
- **WHEN** `start` is called with an entry the document does not declare
- **THEN** the thrown value SHALL be an instance of `UnknownSubagentError` and of `Error`
- **AND** its `name` SHALL be `"UnknownSubagentError"`

#### Scenario: A choices refusal is identifiable by class and name
- **WHEN** `start` is called with `choices` naming an undeclared variable
- **THEN** the thrown value SHALL be an instance of `InvalidChoicesError` and of `Error`
- **AND** its `name` SHALL be `"InvalidChoicesError"`

### Requirement: A Fresh Run State Has An Exact Shape And Is Plain JSON
`start` SHALL return a `RunState` with exactly `version: 1`, `sourceHash: hashSource(source)`, `entries`, `cursor: 0`, `variables`, `steps: []` and `actions: []`, plus `choices` only when `start` was given choices, and no `stopped` or `awaiting`. Every `RunState` the machine produces SHALL be plain JSON (no functions, class instances, `Map`s or cycles), so a `JSON.parse(JSON.stringify(state))` copy behaves identically in `next`, `apply` and `applyAction`.

#### Scenario: The initial state has no step awaiting
- **WHEN** `start` returns
- **THEN** the state's `version` SHALL be `1`, `cursor` SHALL be `0`, `steps` and `actions` SHALL be `[]`
- **AND** `awaiting` and `stopped` SHALL be undefined
- **AND** `sourceHash` SHALL equal `hashSource(source)`

#### Scenario: A state round-tripped through JSON drives the same run
- **GIVEN** a run driven by hand where every state is passed through `JSON.parse(JSON.stringify(...))` between every call
- **WHEN** it is driven with the same answers as `run()` is given through a port
- **THEN** the hand-driven result SHALL deep-equal `run()`'s result

#### Scenario: Choices travel in the state
- **WHEN** `start` is called with `choices: { next_action: ["retry", "ask"] }` on a document declaring `next_action` as a string defaulting to `"retry"`
- **THEN** the state's `choices` SHALL equal `{ next_action: ["retry", "ask"] }`
- **AND** a state started without choices SHALL have no `choices` key

### Requirement: Run Drives The Step Machine Through A Port
`run(source, options?)` SHALL reject with `NoReasoningPortError` first when `options.port` is undefined. Otherwise it SHALL call `start(source, { entry, variables, choices })`, then loop `next` (with `persistVariables: options.persistVariables === true`) and `apply(await port.reason(request))` until `done`, passing each request unchanged; `start` refusals reject before any port call. The result is `{ kind, steps, variables }`, plus `updatedSource` only when asked.

#### Scenario: No port means a refusal, not a default
- **WHEN** `run` is called with no `port`
- **THEN** it SHALL reject with `NoReasoningPortError`

#### Scenario: run and the hand-driven machine agree
- **GIVEN** the same source, entries and answers
- **WHEN** the run is executed through `run()` and through `start`/`next`/`apply` with JSON round-trips
- **THEN** the two results SHALL be deep-equal, with `kind` `"completed"`

#### Scenario: A refused document never reaches the port
- **GIVEN** a document with an error-severity diagnostic
- **WHEN** `run` is called on it with a recording port
- **THEN** it SHALL reject with `UnparsedDocumentError` and the port SHALL have received no request

#### Scenario: run passes choices to start
- **WHEN** `run` is called with `choices: { next_action: ["retry", "ask"] }` and a recording port
- **THEN** the judge step's request SHALL carry `enum: ["retry", "ask"]` on `next_action`
