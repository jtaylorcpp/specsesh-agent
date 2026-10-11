# core/step-machine Specification

## Purpose
Running a script as start, next and apply over a plain-JSON RunState, so a host can persist the state between steps and resume a run after a crash. run() is the same machine as a loop.

## Requirements

### Requirement: The Step Machine Is Exported From The Interpreter Entry
The core package's `./interpreter` entry SHALL export the functions `start`, `next`, `apply`, `run` and `hashSource`, the types `RunState`, `AwaitingStep`, `NextStep`, `StartOptions`, `RunOptions`, `RunResult` and `StepReport`, and the step-machine error classes. None of these functions SHALL write a file, open a network connection, read a credential or import a model client.

#### Scenario: Every step-machine export is reachable from the entry
- **WHEN** a consumer imports `start`, `next`, `apply`, `run`, `hashSource`, `SourceMismatchError` and `RunStateError` from `./interpreter`
- **THEN** each import SHALL resolve to a defined value

#### Scenario: A run does not touch the author's file
- **GIVEN** a script saved on disk whose run changes a variable
- **WHEN** the script's text is run to completion
- **THEN** the file on disk SHALL be byte-for-byte unchanged
- **AND** the result SHALL carry no `updatedSource` unless `persistVariables` was asked for

### Requirement: Every Error Names Itself
Each step-machine error — `SourceMismatchError`, `RunStateError`, `UnparsedDocumentError`, `UnreadableDocumentError`, `NoEntrySubagentError`, `UnknownSubagentError`, `UndeclaredOverrideError`, `EmptyPromptError` — SHALL be exported, SHALL extend `Error`, and SHALL set `name` to its class name, so a caller tells refusals apart without reading the message.

#### Scenario: A refusal is identifiable by class and name
- **WHEN** `start` is called with an entry the document does not declare
- **THEN** the thrown value SHALL be an instance of `UnknownSubagentError` and of `Error`
- **AND** its `name` SHALL be `"UnknownSubagentError"`

### Requirement: Start Checks The Whole Document Before Anything Else
`start(source, options?)` SHALL analyse the source once and refuse in this order before returning a state: any error-severity (LSP `1`) diagnostic → `UnparsedDocumentError`; no document root → `UnreadableDocumentError`; any unsupported construct → `UnsupportedConstructError` with every finding (`core/subset`); any undeclared `@variables.x` on any branch → the first `UndeclaredVariableError` (`core/composition`). Warning, information and hint diagnostics MUST NOT refuse.

#### Scenario: A hard syntax error is refused, not run on the recovered tree
- **GIVEN** a document containing `set @variables.stage = "unterminated` (an unterminated string)
- **WHEN** `start` is called on it
- **THEN** it SHALL throw `UnparsedDocumentError`
- **AND** no state SHALL be returned and no request SHALL ever be composed

#### Scenario: A warning alone does not stop a run
- **GIVEN** a document whose only diagnostics are of warning or hint severity (for example an unused variable)
- **WHEN** `start` is called on it
- **THEN** it SHALL return a `RunState`

#### Scenario: Error diagnostics win over unsupported constructs
- **GIVEN** a document that has both an error-severity diagnostic and a construct outside the subset
- **WHEN** `start` is called on it
- **THEN** it SHALL throw `UnparsedDocumentError`, not `UnsupportedConstructError`

#### Scenario: An unsupported construct on a branch the run would never take is still refused
- **GIVEN** a lint-clean document whose second subagent uses a construct outside the subset
- **WHEN** `start` is called with the default entry (the first subagent)
- **THEN** it SHALL throw `UnsupportedConstructError`

#### Scenario: An undeclared reference the dialect itself reports is refused as a diagnostic
- **GIVEN** a document whose instructions read `@variables.approved` with no `approved` declared
- **WHEN** `start` is called on it
- **THEN** it SHALL throw `UnparsedDocumentError` whose `diagnostics` include the dialect's `'approved' is not defined in variables`

### Requirement: An Unparsed Document Refusal Lists Its Diagnostics With Positions
`UnparsedDocumentError` SHALL carry `diagnostics`, exactly the error-severity diagnostics. Its message SHALL begin `the document has <n> error(s) and was not run. Nothing was dispatched:`, then one line per diagnostic, `  - <message> at <line>:<character>` (1-based), or `  - <message> at an unreported position` when it has no range.

#### Scenario: Each error diagnostic is listed with a 1-based position
- **GIVEN** a document with one error-severity diagnostic whose range starts at 0-based line 9, character 4
- **WHEN** `start` throws `UnparsedDocumentError`
- **THEN** its message SHALL contain `the document has 1 error(s) and was not run`
- **AND** it SHALL contain ` at 10:5`
- **AND** its `diagnostics` SHALL have length 1

#### Scenario: Warnings are not listed
- **GIVEN** a document with one error and one warning diagnostic
- **WHEN** `start` throws `UnparsedDocumentError`
- **THEN** `diagnostics` SHALL contain only the error

### Requirement: An Unreadable Document Is Refused
When the analysis yields no document root, `start` SHALL throw `UnreadableDocumentError` whose message begins `the document could not be parsed into anything runnable. Nothing was dispatched.` A document with no root MUST NOT be reported as a completed run with no steps.

#### Scenario: No root means a refusal, not an empty success
- **GIVEN** a source for which the analysis returns no root and no error diagnostic
- **WHEN** `start` is called on it
- **THEN** it SHALL throw `UnreadableDocumentError`

### Requirement: The Opening Variables Are The Authored Values, Then The Overrides
`start` SHALL build `variables` from every declared variable's authored default, in declaration order, then replace values from `options.variables`, stored as given without type coercion. An override for an undeclared name SHALL throw `UndeclaredOverrideError`, whose message contains `the run was given a starting value for "<name>", which the document does not declare` and lists the declared names or `(none)`.

#### Scenario: Authored values seed the run
- **GIVEN** a document declaring `report: mutable string = "it crashes"`, `severity: mutable string = ""` and `urgent: mutable boolean = False`
- **WHEN** `start` is called with no overrides
- **THEN** the state's `variables` SHALL equal `{ report: "it crashes", severity: "", urgent: false }`

#### Scenario: An override replaces an authored value
- **GIVEN** the same document
- **WHEN** `start` is called with `variables: { report: "slow" }`
- **THEN** the state's `variables.report` SHALL be `"slow"`
- **AND** the first composed prompt SHALL read the overridden value

#### Scenario: An override for an undeclared name is refused
- **WHEN** `start` is called with `variables: { nope: 1 }` on a document that does not declare `nope`
- **THEN** it SHALL throw `UndeclaredOverrideError`
- **AND** its message SHALL name `nope` and list the declared variables

### Requirement: Entries Resolve From The Option, Or Default To The First Subagent
`start` SHALL resolve `options.entry` to an ordered list of subagents: a string `s` becomes `[s]`; an array is used as given, in order, duplicates included; absent becomes a one-element list of the first subagent declared in source order. An empty list SHALL throw `NoEntrySubagentError` (`would enter no subagent`). The first undeclared name SHALL throw `UnknownSubagentError` (`the document declares no subagent named "<name>"`), all checked before returning.

#### Scenario: The default entry is the first declared subagent only
- **GIVEN** a document declaring subagents `classify`, `gate`, `respond` in that order
- **WHEN** `start` is called with no `entry`
- **THEN** the state's `entries` SHALL equal `["classify"]`

#### Scenario: A string entry becomes a one-element list
- **WHEN** `start` is called with `entry: "gate"`
- **THEN** the state's `entries` SHALL equal `["gate"]`

#### Scenario: An array entry keeps its order
- **WHEN** `start` is called with `entry: ["respond", "classify"]`
- **THEN** the state's `entries` SHALL equal `["respond", "classify"]`

#### Scenario: A document with no subagent is refused
- **GIVEN** a lint-clean document declaring no subagent
- **WHEN** `start` is called
- **THEN** it SHALL throw `NoEntrySubagentError` whose message contains `(none)`

#### Scenario: An explicitly empty entry list is refused
- **WHEN** `start` is called with `entry: []` on a document that declares subagents
- **THEN** it SHALL throw `NoEntrySubagentError`

#### Scenario: An unknown entry anywhere in the list is refused before anything is composed
- **WHEN** `start` is called with `entry: ["classify", "nope"]`
- **THEN** it SHALL throw `UnknownSubagentError` whose message contains `no subagent named "nope"`

### Requirement: A Fresh Run State Has An Exact Shape And Is Plain JSON
`start` SHALL return a `RunState` with exactly `version: 1`, `sourceHash: hashSource(source)`, `entries`, `cursor: 0`, `variables` and `steps: []`, and no `stopped` or `awaiting`. Every `RunState` the machine produces SHALL be plain JSON (no functions, class instances, `Map`s or cycles), so a `JSON.parse(JSON.stringify(state))` copy behaves identically in `next` and `apply`.

#### Scenario: The initial state has no step awaiting
- **WHEN** `start` returns
- **THEN** the state's `version` SHALL be `1`, `cursor` SHALL be `0`, `steps` SHALL be `[]`
- **AND** `awaiting` and `stopped` SHALL be undefined
- **AND** `sourceHash` SHALL equal `hashSource(source)`

#### Scenario: A state round-tripped through JSON drives the same run
- **GIVEN** a run driven by hand where every state is passed through `JSON.parse(JSON.stringify(...))` between every call
- **WHEN** it is driven with the same answers as `run()` is given through a port
- **THEN** the hand-driven result SHALL deep-equal `run()`'s result

### Requirement: A State Is Only Valid With The Source It Was Started On
`next(source, state)` and `apply(source, state, outcome)` SHALL throw `SourceMismatchError` when `state.version` is not `1` or when `state.sourceHash` differs from `hashSource(source)`. Its message SHALL say the state `was started on a different document` and that `a changed script means a new run`. After this check both functions SHALL re-run the full load of the source, so every refusal `start` can raise MAY also be raised by `next` and `apply`.

#### Scenario: An edited script is refused by next and apply
- **GIVEN** a state awaiting a step, started on a source
- **WHEN** `next` or `apply` is called with that source edited by one character
- **THEN** each SHALL throw `SourceMismatchError`

#### Scenario: A state from an unknown version is refused
- **GIVEN** a state from `start` with `version` changed to `2`
- **WHEN** `next` is called with the original source
- **THEN** it SHALL throw `SourceMismatchError`

### Requirement: Next Re-Dispatches An Awaiting Step Unchanged
When `state.awaiting` is set, `next` SHALL return `{ type: "request", request: state.awaiting.request, state }` — the same request and the same state it was given — without composing anything, running any logic line, or changing any field. It MUST NOT throw because a step is awaiting.

#### Scenario: A host that crashed after next and before apply asks again
- **GIVEN** the state returned by a `next` that produced a request, saved as JSON
- **WHEN** a restarted host calls `next` with the saved state
- **THEN** the returned `request` SHALL deep-equal the first request
- **AND** the returned `state` SHALL deep-equal the saved state

### Requirement: Next Is Pure
`next` SHALL be a pure function of `(source, state, options)`: the same inputs SHALL always produce a deep-equal `NextStep`, and `next` MUST NOT mutate the `state` object it is given.

#### Scenario: The same state yields the same request twice
- **WHEN** `next` is called on a state and on that state's JSON round-trip
- **THEN** both results SHALL be deep-equal

### Requirement: Next Runs Logic-Only Subagents Without A Request
From `state.cursor`, `next` SHALL compose each entry in turn against a working copy of `state.variables` (`core/composition`). An entry composing to an empty prompt with no pending assignments SHALL count as finished: its logic effects stay in the working copy, the cursor moves past it, no request is made. An empty prompt with pending assignments SHALL throw `EmptyPromptError`, naming the subagent and fields and saying `Nothing was dispatched`.

#### Scenario: A logic-only subagent between two model steps makes no request
- **GIVEN** entries `classify` (prompt plus `set @variables.severity = @outputs.severity`), `gate` (only `if @variables.severity == "high": set @variables.urgent = True`) and `respond` (prompt depending on `urgent`)
- **WHEN** the run is driven with `classify` answering `{ severity: "high" }`
- **THEN** exactly two requests SHALL be produced, for `classify` and `respond`
- **AND** the second prompt SHALL be `Write an urgent reply about: it crashes`
- **AND** the result's `steps` SHALL name only `classify` and `respond`

#### Scenario: The logic decides the other way
- **WHEN** the same run is driven with `classify` answering `{ severity: "low" }`
- **THEN** the second prompt SHALL be `Write a routine reply about: it crashes`
- **AND** the result's `variables.urgent` SHALL be `false`

#### Scenario: An empty prompt that still asks for a structured result is refused
- **GIVEN** a subagent whose every prompt line sits behind a condition that does not hold and which still carries `set @variables.x = @outputs.y`
- **WHEN** `next` reaches it
- **THEN** it SHALL throw `EmptyPromptError` naming the subagent and the field `y`
- **AND** no request SHALL be returned

### Requirement: Next Builds Each Request Fresh
For the first entry with a non-empty prompt, `next` SHALL return `{ type: "request", request, state }` with `request` built fresh: `systemInstructions` (the document's system block), `prompt` (the composed prompt) and, only when there are pending assignments, `outputSchema` (`core/composition`). A request with no pending assignments MUST NOT carry an `outputSchema` key.

#### Scenario: Every request restates the system instructions in full
- **GIVEN** a two-step run through a port
- **WHEN** both requests are recorded
- **THEN** each SHALL carry the same `systemInstructions`, and the second SHALL carry its own prompt in full
- **AND** a brand-new port with no history SHALL receive the second request deep-equal to the original

#### Scenario: A text-only step carries no schema
- **WHEN** `next` composes a step with no `set ... = @outputs.*`
- **THEN** the request SHALL have keys `systemInstructions` and `prompt` only

### Requirement: The Returned State Carries An Awaiting Step
The state `next` returns with a request SHALL be the input state with `cursor` set to that entry's index and `awaiting` set to `{ subagent, request, pending, variables, before }`: `pending` in source order, `variables` the working copy after this entry's own logic lines, `before` the working copy after any logic-only entries this call ran but before this entry's own logic lines. Top-level `variables`, `steps` and `stopped` SHALL be unchanged.

#### Scenario: The awaiting step separates its own effects from earlier ones
- **GIVEN** an answered `classify` step, then logic-only `gate` setting `urgent = True`, then `respond`
- **WHEN** `next` returns the request for `respond`
- **THEN** `awaiting.before.urgent` SHALL be `true`
- **AND** the state's top-level `variables.urgent` SHALL still be `false`

### Requirement: Next Finishes With The Run's Result
When the cursor passes the last entry, or `state.stopped` is set, `next` SHALL return `{ type: "done", result }` with `kind` = `state.stopped ?? "completed"`, `steps` = `state.steps`, and `variables` = the working copy, including trailing logic-only effects. A stopped state SHALL answer `done` on every later call. `updatedSource` SHALL be present only when called with `{ persistVariables: true }`.

#### Scenario: A stopped run keeps answering done
- **GIVEN** a state returned by `apply` with a failed outcome
- **WHEN** `next` is called on it, and on its JSON round-trip
- **THEN** both SHALL return `type: "done"`

#### Scenario: A trailing logic-only subagent's effects reach the result
- **GIVEN** entries whose last subagent is logic only and sets a variable
- **WHEN** the run completes
- **THEN** the result's `variables` SHALL include that assignment

### Requirement: Persisted Variables Rewrite Only The Changed Authored Values
`updatedSource` SHALL be the source with each authored default replaced at its own span by the final value, only where the final value differs (`!==`) from the authored one; all other bytes SHALL be preserved. Strings SHALL be written as JSON string literals, numbers via `String(n)`, booleans as the dialect's `True` / `False`, never `true` / `false`. Edits SHALL apply back to front so none moves another's span.

#### Scenario: A changed string is rewritten in place
- **GIVEN** a run that moves `stage` from `"proposal"` to `"specs"`
- **WHEN** it runs with `persistVariables: true`
- **THEN** `updatedSource` SHALL contain `stage: mutable string = "specs"`

#### Scenario: A boolean is written in the dialect's spelling and still lints clean
- **GIVEN** a lint-clean document whose run sets `approved` to `true`
- **WHEN** it runs with `persistVariables: true`
- **THEN** `updatedSource` SHALL contain `approved: mutable boolean = True` and not `= true`
- **AND** analysing `updatedSource` SHALL report no diagnostics

#### Scenario: An unchanged value is not touched
- **WHEN** a run ends with every variable at its authored value and `persistVariables: true`
- **THEN** `updatedSource` SHALL equal the source exactly

### Requirement: Apply Needs An Awaiting Step
`apply(source, state, outcome)` SHALL throw `RunStateError` with message `apply was called with no step awaiting an answer` when `state.awaiting` is undefined, including a fresh or a stopped state.

#### Scenario: Apply with no step awaiting is refused
- **WHEN** `apply` is called on a state fresh from `start`
- **THEN** it SHALL throw `RunStateError` with `name` `"RunStateError"`

### Requirement: Apply Folds One Answer Into The State
`apply` SHALL normalise the outcome (`core/reasoning-port`) and, when the step has pending assignments, apply the structured result to a copy of `awaiting.variables` (`core/composition`), which MAY turn answered into failed. It SHALL append `{ subagent, request, outcome }` to `steps` and drop `awaiting`. Answered: `variables` = the copy, `cursor` + 1. Otherwise: `stopped` = the `kind`, `cursor` unchanged, `variables` = `awaiting.before`. The input MUST NOT be mutated.

#### Scenario: An answered structured step commits its result and advances
- **GIVEN** a state awaiting `classify` with pending `severity`
- **WHEN** `apply` is called with `{ kind: "answered", text: "", structured: { severity: "high" } }`
- **THEN** the new state's `variables.severity` SHALL be `"high"`, `cursor` SHALL be one more, `awaiting` SHALL be undefined
- **AND** `steps` SHALL end with a report naming `classify`

#### Scenario: A failed step commits nothing from itself and stops the run
- **GIVEN** a state awaiting `classify`
- **WHEN** `apply` is called with `{ kind: "failed", category: "rate_limit", message: "slow down" }`
- **THEN** the new state's `stopped` SHALL be `"failed"`, `variables.severity` SHALL still be `""`
- **AND** the last step's outcome SHALL deep-equal the reported failure
- **AND** the finished result's `kind` SHALL be `"failed"` after exactly one request

#### Scenario: A failed step's own logic-line effects are rolled back
- **GIVEN** a subagent that sets `stage = "specs"` by a logic line in the same step as its prompt
- **WHEN** that step fails
- **THEN** the result's `variables.stage` SHALL be its value before the step, `"proposal"`

#### Scenario: Earlier logic-only subagents' effects survive a later failure
- **GIVEN** `classify` answered `{ severity: "high" }`, logic-only `gate` set `urgent = True`, and `respond` fails
- **WHEN** the run finishes
- **THEN** the result's `variables` SHALL equal `{ report: "it crashes", severity: "high", urgent: true }`

#### Scenario: A cut-short step stops the run as cut short
- **WHEN** a step is answered `{ kind: "cut-short", text: "half", turns: 9 }`
- **THEN** the result's `kind` SHALL be `"cut-short"`

#### Scenario: A host that crashed after apply carries on from the next step
- **GIVEN** the JSON-saved state returned by `apply` for an answered `classify`
- **WHEN** a restarted host calls `next` on it
- **THEN** the request SHALL be for the following model step, with the prompt reflecting the applied result

### Requirement: The Run State Is All A Host Persists
A host SHALL be able to persist a run by saving only the source text and the latest `RunState` after each `next` and each `apply`; no other runtime value is needed to resume. Crashing between `next` and `apply` SHALL lead to re-dispatching the identical request; crashing after `apply` SHALL continue from the following step without re-running the finished one.

#### Scenario: Resume after either crash point produces the same result
- **GIVEN** a run driven with every state saved as JSON
- **WHEN** the driver is restarted from the saved state after a `next`, and separately after an `apply`
- **THEN** each resumed run SHALL finish with a result deep-equal to an uninterrupted run with the same answers

### Requirement: Run Drives The Step Machine Through A Port
`run(source, options?)` SHALL reject with `NoReasoningPortError` first when `options.port` is undefined. Otherwise it SHALL call `start(source, { entry, variables })`, then loop `next` (with `persistVariables: options.persistVariables === true`) and `apply(await port.reason(request))` until `done`, passing each request unchanged; `start` refusals reject before any port call. The result is `{ kind, steps, variables }`, plus `updatedSource` only when asked.

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

### Requirement: The Source Fingerprint Is A Fixed FNV-1a Format
`hashSource(source)` SHALL compute 32-bit FNV-1a (basis `0x811c9dc5`, prime `0x01000193`) over UTF-16 code units and return `<length>-<hash>`: `source.length` in unpadded lower-case hex, then the hash in lower-case hex padded to 8 digits. It SHALL use plain JavaScript with no Node or Web API, so it runs on Node and Workers. It is not cryptographic and MUST NOT be relied on against deliberate collisions.

#### Scenario: Known values
- **WHEN** `hashSource` is called with `""`, `"a"` and a string of 300 `x` characters
- **THEN** it SHALL return `"0-811c9dc5"`, `"1-e40c292c"` and `"12c-970138f5"` respectively

#### Scenario: Length counts UTF-16 code units
- **WHEN** `hashSource` is called with a single emoji outside the Basic Multilingual Plane (`"😀"`)
- **THEN** the result SHALL begin `"2-"`
