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
`StartScriptOptions` SHALL extend the core `StartOptions` (`entry`, `variables`) with `conversation?: Conversation` and `model?: ModelRef`. `startScript` MUST store the task input as `{ source, options: <every option except conversation and model>, model }`, omitting the `model` key when no model was given. `conversation` MUST NOT be stored in the task input.

#### Scenario: Entry and variable overrides reach the step machine
- **WHEN** a host calls `startScript` with `{ entry: ["classify", "gate", "respond"], variables: { report: "slow" }, model }`
- **THEN** the task input's `options` SHALL equal `{ entry: ["classify", "gate", "respond"], variables: { report: "slow" } }`
- **AND** the first step's prompt SHALL be `Classify: slow`

#### Scenario: No model means no model key
- **WHEN** a host calls `startScript` without `model`
- **THEN** the task input SHALL have no `model` key

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
