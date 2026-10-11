## ADDED Requirements

### Requirement: Next yields a deterministic subagent's calls one at a time
Walking a deterministic subagent, `next` SHALL stop at each reached `run` and return `{ type: "action", call, state }`. `call` SHALL be `{ subagent, action, tool, inputs, index }`: the action's name, its `mcpTool://` tool name, the evaluated inputs, and the statement position to resume after. `state.awaiting` SHALL be an `AwaitingAction` `{ subagent, call, variables, before }`.

#### Scenario: A check subagent yields its call
- **GIVEN** the default task script's `check` subagent with `task_id` `"2.4"`
- **WHEN** `next` reaches it
- **THEN** it SHALL return `type: "action"` with `call` `{ subagent: "check", action: "run_checks", tool: "run_checks", inputs: { task_id: "2.4" }, index: 0 }`

#### Scenario: Two runs in one subagent are yielded in order
- **GIVEN** a deterministic subagent with two `run` statements
- **WHEN** the first call's result is applied and `next` is called again
- **THEN** the second call SHALL be returned, with a higher `index`

### Requirement: applyAction folds one action result into the state
`applyAction(source, state, result)` SHALL throw `RunStateError` (`applyAction was called with no action awaiting`) unless `state.awaiting` is an action call. `ActionResult` SHALL be `{ ok: true, outputs, record? } | { ok: false, message, record? }`, `record` being opaque JSON kept as given. It SHALL append `{ subagent, call, result }` to `actions`, apply outputs (`core/composition`), and keep the walk's resume point. The input MUST NOT be mutated.

#### Scenario: A successful result continues the walk
- **GIVEN** a state awaiting `run_checks`
- **WHEN** `applyAction` is called with `{ ok: true, outputs: { passed: true, output: "ok" } }`
- **THEN** `actions` SHALL end with that report and the next `next` SHALL continue after the `run`

#### Scenario: applyAction with a step awaiting is refused
- **WHEN** `applyAction` is called on a state awaiting a model step
- **THEN** it SHALL throw `RunStateError`

### Requirement: A failed action stops the run and rolls back its subagent
When the result is `{ ok: false }`, or applying its outputs fails, `applyAction` SHALL set `stopped` to `"failed"`, set `variables` to `awaiting.before` (so the failing subagent's own logic effects are not committed, and earlier finished subagents' are), and drop `awaiting`. The run's result SHALL then be `failed`, with the failed call as the last entry of `actions`.

#### Scenario: A failed check call ends the run failed
- **GIVEN** a deterministic subagent that sets `stage = "checking"` and then runs `run_checks`
- **WHEN** the host answers `{ ok: false, message: "interrupted and not re-run" }`
- **THEN** the result's `kind` SHALL be `"failed"`, `stage` SHALL keep its value from before the subagent, and the last action report SHALL carry that message

## MODIFIED Requirements

### Requirement: The Step Machine Is Exported From The Interpreter Entry
The core package's `./interpreter` entry SHALL export the functions `start`, `next`, `apply`, `applyAction`, `run` and `hashSource`, the types `RunState`, `AwaitingStep`, `AwaitingAction`, `ActionCall`, `ActionResult`, `ActionReport`, `NextStep`, `StartOptions`, `RunOptions`, `RunResult` and `StepReport`, and the step-machine error classes. None of these functions SHALL write a file, open a network connection, read a credential or import a model client.

#### Scenario: Every step-machine export is reachable from the entry
- **WHEN** a consumer imports `start`, `next`, `apply`, `applyAction`, `run`, `hashSource`, `SourceMismatchError` and `RunStateError` from `./interpreter`
- **THEN** each import SHALL resolve to a defined value

#### Scenario: A run does not touch the author's file
- **GIVEN** a script saved on disk whose run changes a variable
- **WHEN** the script's text is run to completion
- **THEN** the file on disk SHALL be byte-for-byte unchanged
- **AND** the result SHALL carry no `updatedSource` unless `persistVariables` was asked for

### Requirement: A Fresh Run State Has An Exact Shape And Is Plain JSON
`start` SHALL return a `RunState` with exactly `version: 1`, `sourceHash: hashSource(source)`, `entries`, `cursor: 0`, `variables`, `steps: []` and `actions: []`, and no `stopped` or `awaiting`. Every `RunState` the machine produces SHALL be plain JSON (no functions, class instances, `Map`s or cycles), so a `JSON.parse(JSON.stringify(state))` copy behaves identically in `next`, `apply` and `applyAction`.

#### Scenario: The initial state has no step awaiting
- **WHEN** `start` returns
- **THEN** the state's `version` SHALL be `1`, `cursor` SHALL be `0`, `steps` and `actions` SHALL be `[]`
- **AND** `awaiting` and `stopped` SHALL be undefined
- **AND** `sourceHash` SHALL equal `hashSource(source)`

#### Scenario: A state round-tripped through JSON drives the same run
- **GIVEN** a run driven by hand where every state is passed through `JSON.parse(JSON.stringify(...))` between every call
- **WHEN** it is driven with the same answers as `run()` is given through a port
- **THEN** the hand-driven result SHALL deep-equal `run()`'s result

### Requirement: Next Re-Dispatches An Awaiting Step Unchanged
When `state.awaiting` is set, `next` SHALL return it unchanged with the same state it was given: `{ type: "request", request: state.awaiting.request, state }` for an awaiting step, `{ type: "action", call: state.awaiting.call, state }` for an awaiting action call. It SHALL compose nothing, run no logic line and change no field, and MUST NOT throw because something is awaiting.

#### Scenario: A host that crashed after next and before apply asks again
- **GIVEN** the state returned by a `next` that produced a request, saved as JSON
- **WHEN** a restarted host calls `next` with the saved state
- **THEN** the returned `request` SHALL deep-equal the first request
- **AND** the returned `state` SHALL deep-equal the saved state

#### Scenario: A host that crashed before applying an action asks again
- **GIVEN** the state returned by a `next` that produced an action call, saved as JSON
- **WHEN** a restarted host calls `next` with the saved state
- **THEN** it SHALL return `type: "action"` with a `call` deep-equal to the first one, and the saved state unchanged

### Requirement: Next Runs Logic-Only Subagents Without A Request
From `state.cursor`, `next` SHALL compose each entry in turn against a working copy of `state.variables` (`core/composition`). An entry that composes to an empty prompt, no pending assignments and no reached `run` SHALL count as finished: its logic effects stay, the cursor moves past it, no request is made. An empty prompt with pending assignments SHALL throw `EmptyPromptError`, naming the subagent and fields and saying `Nothing was dispatched`.

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

### Requirement: Next Finishes With The Run's Result
When the cursor passes the last entry, or `state.stopped` is set, `next` SHALL return `{ type: "done", result }` with `kind` = `state.stopped ?? "completed"`, `steps` = `state.steps`, `actions` = `state.actions`, and `variables` = the working copy, including trailing logic-only effects. A stopped state SHALL answer `done` on every later call. `updatedSource` SHALL be present only when called with `{ persistVariables: true }`.

#### Scenario: A stopped run keeps answering done
- **GIVEN** a state returned by `apply` with a failed outcome
- **WHEN** `next` is called on it, and on its JSON round-trip
- **THEN** both SHALL return `type: "done"`

#### Scenario: A trailing logic-only subagent's effects reach the result
- **GIVEN** entries whose last subagent is logic only and sets a variable
- **WHEN** the run completes
- **THEN** the result's `variables` SHALL include that assignment

### Requirement: Apply Needs An Awaiting Step
`apply(source, state, outcome)` SHALL throw `RunStateError` with message `apply was called with no step awaiting an answer` when `state.awaiting` is undefined, including a fresh or a stopped state, and with message `apply was called while an action call is awaiting; use applyAction` when `state.awaiting` is an action call.

#### Scenario: Apply with no step awaiting is refused
- **WHEN** `apply` is called on a state fresh from `start`
- **THEN** it SHALL throw `RunStateError` with `name` `"RunStateError"`

#### Scenario: Apply with an action awaiting is refused
- **GIVEN** a state whose `awaiting` holds an action call
- **WHEN** `apply` is called on it
- **THEN** it SHALL throw `RunStateError` naming `applyAction`

### Requirement: The Run State Is All A Host Persists
A host SHALL be able to persist a run by saving only the source text and the latest `RunState` after each `next`, `apply` and `applyAction`; no other runtime value is needed to resume. Crashing after `next` and before the answer or result is folded in SHALL lead to the identical request or action call again; crashing after it is folded in SHALL continue without repeating the finished step or call.

#### Scenario: Resume after either crash point produces the same result
- **GIVEN** a run driven with every state saved as JSON
- **WHEN** the driver is restarted from the saved state after a `next`, and separately after an `apply`
- **THEN** each resumed run SHALL finish with a result deep-equal to an uninterrupted run with the same answers

#### Scenario: Resume after an action result continues past the call
- **GIVEN** the JSON-saved state returned by `applyAction` for a successful call
- **WHEN** a restarted host calls `next` on it
- **THEN** the walk SHALL continue after that `run`, and the same call SHALL NOT be produced again
