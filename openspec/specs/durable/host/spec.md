# durable/host Specification

## Purpose
Starting and awaiting script runs from any host that holds a pi-durable Harness.

## Requirements

### Requirement: startScript durably creates a run task and returns its ID
`@specsesh/agent/durable` SHALL export `startScript(harness, source, options, context): Promise<TaskId<RunResult>>`. It MUST create an `agentscript.run` task (see `durable/run-task`) in one commit on the owning conversation, with task ownership `{ kind: "conversation" }`, and resolve to the new task's numeric ID. The owner MUST be `options.conversation` when given, else `await harness.root(context)`.

#### Scenario: A run is created on the root conversation by default
- **GIVEN** an open harness and no `conversation` option
- **WHEN** a host calls `startScript(harness, source, { entry, model }, context)`
- **THEN** a task named `agentscript.run` SHALL be created on the root conversation
- **AND** the promise SHALL resolve to an integer task ID

#### Scenario: A run can belong to a given conversation
- **GIVEN** a `Conversation` object `owner`
- **WHEN** a host calls `startScript` with `{ conversation: owner }`
- **THEN** the task SHALL be created through `owner.commit`, owned by that conversation

#### Scenario: Refusals reject the call and create nothing
- **GIVEN** a script the `core/step-machine` refuses at `start` (for example an unsupported top-level block)
- **WHEN** a host calls `startScript`
- **THEN** the promise SHALL reject with that refusal and no model request SHALL be made

### Requirement: startScript does not run the script itself
`startScript` SHALL NOT wait for the run, call `harness.resume()`, or make any model request itself; the harness schedules the new task.

#### Scenario: startScript resolves before any model request
- **GIVEN** a faux provider that records requests
- **WHEN** `startScript` resolves
- **THEN** the run SHALL proceed only through the harness's scheduler, and `startScript` itself SHALL have made no model request

### Requirement: startScript splits its options into start options and the model
`StartScriptOptions` SHALL extend the core `StartOptions` (`entry`, `variables`, `choices`) with `conversation?: Conversation` and `model?: ModelRef`. `startScript` MUST store the task input as `{ source, options: <every option except conversation and model>, model }`, omitting the `model` key when no model was given. `conversation` MUST NOT be stored in the task input.

#### Scenario: Entry and variable overrides reach the step machine
- **WHEN** a host calls `startScript` with `{ entry: ["classify", "gate", "respond"], variables: { report: "slow" }, model }`
- **THEN** the task input's `options` SHALL equal `{ entry: ["classify", "gate", "respond"], variables: { report: "slow" } }`
- **AND** the first step's prompt SHALL be `Classify: slow`

#### Scenario: No model means no model key
- **WHEN** a host calls `startScript` without `model`
- **THEN** the task input SHALL have no `model` key

#### Scenario: Choices reach the step machine
- **WHEN** a host calls `startScript` with `{ choices: { next_action: ["retry", "ask"] }, model }`
- **THEN** the task input's `options` SHALL equal `{ choices: { next_action: ["retry", "ask"] } }`

### Requirement: waitForScript returns the result of a completed run
`@specsesh/agent/durable` SHALL export `waitForScript(harness, id, context): Promise<RunResult>`, which awaits `harness.waitForTask(id, context)` and, when the task is terminal with outcome status `completed`, MUST resolve to that outcome's `RunResult` unchanged — including runs whose `kind` is `"failed"` or `"cut-short"`.

#### Scenario: A completed run returns its result
- **GIVEN** a pipeline run whose steps both answer
- **WHEN** a host awaits `waitForScript`
- **THEN** it SHALL resolve to a `RunResult` with `kind: "completed"`

#### Scenario: A run that failed at a step still resolves
- **GIVEN** a pipeline run whose `respond` step fails at the provider
- **WHEN** a host awaits `waitForScript`
- **THEN** it SHALL resolve, not reject, to a `RunResult` with `kind: "failed"`

### Requirement: waitForScript refuses a task that is not terminal
When `harness.waitForTask` hands back a record whose `state.status` is not `terminal`, `waitForScript` SHALL throw an error whose message is `agentscript run <id> is <status>, not finished. Task IDs are numbers; check the ID passed in.`. On node SQLite storage (the CLI's), pi-durable matches a string ID such as `"7"` to task 7 and returns its live record, so this message is what a caller who forgot `Number(...)` sees. On `MemoryStorage`, pi-durable itself throws `Task 7 does not exist` first.

#### Scenario: A string task ID is caught by name
- **GIVEN** a running task on node SQLite storage whose ID was read from text and passed without `Number(...)`
- **WHEN** a host calls `waitForScript` with the string
- **THEN** it SHALL reject with a message containing `not finished` and `Task IDs are numbers`

### Requirement: waitForScript rejects a run that ended other than completed
When the task is terminal with an outcome status other than `completed`, `waitForScript` SHALL throw an error whose message is `agentscript run <id> ended <status>: ` followed by the outcome's `error.message` when it has an `error`, else its `reason`, else the empty string.

#### Scenario: An aborted run rejects with its status
- **GIVEN** a run aborted through `harness.abortTask`
- **WHEN** a host awaits `waitForScript`
- **THEN** it SHALL reject with a message matching `ended aborted`

### Requirement: runScript starts and waits in one call
`@specsesh/agent/durable` SHALL export `runScript(harness, source, options, context): Promise<RunResult>`, equivalent to `waitForScript(harness, await startScript(harness, source, options, context), context)`. It MUST NOT call `harness.resume()`; resuming tasks left unfinished by an earlier process is the host's job.

#### Scenario: A run end to end on an in-memory harness
- **GIVEN** a harness on `MemoryStorage` with both extensions installed, and faux answers `{ severity: "high" }` then `On it, urgently.`
- **WHEN** a host awaits `runScript(harness, PIPELINE, { entry: ["classify", "gate", "respond"], model }, context)`
- **THEN** the result SHALL have `kind: "completed"`, variables `{ report: "it crashes", severity: "high", urgent: true }`, and step subagents `["classify", "respond"]`
- **AND** the second step's prompt SHALL be `Write an urgent reply about: it crashes`

### Requirement: watchScript streams a durable run's RunEvents
`@specsesh/agent/durable` SHALL export `watchScript(harness, id, context)`, returning an async iterable of `RunEvent`s, a `result` promise that settles as `waitForScript(harness, id, context)` would, and `stop()`. It SHALL import no `node:` module. Steps, actions and `run_end` SHALL come in the order `run` reports them, and iteration ends after `run_end`.

#### Scenario: A durable run watched from the start reports every step
- **GIVEN** a two-step script started with `startScript` and watched before `harness.resume()`
- **WHEN** the run completes
- **THEN** the step and run events SHALL be `step_start`, `step_end`, `step_start`, `step_end`, `run_end`, and `result` SHALL equal `waitForScript`'s

#### Scenario: A step's deltas join to its text
- **GIVEN** a faux model streaming `Hello there.` and a throttled progress policy
- **WHEN** the run is watched from the start
- **THEN** the step's `text_delta`s joined SHALL equal its outcome's text

#### Scenario: A tool step reports its call and result
- **GIVEN** a durable host whose registry offers `read`, and a model that calls it, then answers
- **WHEN** the run is watched
- **THEN** `tool_call` and then `tool_result` for `read` SHALL come between that step's `step_start` and `step_end`

### Requirement: A late watcher receives the run's history first
A watcher attached to a started run SHALL first receive `step_start` and `step_end` for every applied step, and `action_start` and `action_end` for every settled action, without deltas, then the in-flight step's `step_start` and its text so far as one `text_delta`, then live events. A watcher of a finished run SHALL receive the history and `run_end`.

#### Scenario: Attaching mid-run replays the finished steps
- **GIVEN** a two-step run whose first step has been applied
- **WHEN** `watchScript` attaches
- **THEN** it SHALL first yield step 0's `step_start` and `step_end`, then step 1's events and `run_end`

#### Scenario: Attaching after the end yields the history
- **WHEN** `watchScript` attaches to a completed run
- **THEN** it SHALL yield every step's `step_start` and `step_end`, then `run_end`, and end

### Requirement: Watching never changes the run
Watchers SHALL only read. Several watchers MAY attach to one run, each receiving every event independently and buffered. `stop()` SHALL end that watcher's iterator and detach it, leaving the run and other watchers unaffected. An id naming another kind of task SHALL reject `result` and throw from the iterator with `task <id> is a <kind> task, not agentscript.run`.

#### Scenario: Two watchers see the same events
- **WHEN** two watchers follow one run, one reading slowly
- **THEN** both SHALL yield the same event sequence

#### Scenario: stop leaves the run running
- **WHEN** a watcher calls `stop()` mid-run
- **THEN** its iterator SHALL end and the run SHALL still complete, as `waitForScript` shows

#### Scenario: A watched run with and without a watcher ends the same
- **WHEN** the same script runs on the same faux replies once watched and once not
- **THEN** both `waitForScript` results SHALL be equal
