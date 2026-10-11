## MODIFIED Requirements

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

### Requirement: runScript starts and waits in one call
`@specsesh/agent/durable` SHALL export `runScript(harness, source, options, context): Promise<RunResult>`, equivalent to `waitForScript(harness, await startScript(harness, source, options, context), context)`. It MUST NOT call `harness.resume()`; resuming tasks left unfinished by an earlier process is the host's job.

#### Scenario: A run end to end on an in-memory harness
- **GIVEN** a harness on `MemoryStorage` with both extensions installed, and faux answers `{ severity: "high" }` then `On it, urgently.`
- **WHEN** a host awaits `runScript(harness, PIPELINE, { entry: ["classify", "gate", "respond"], model }, context)`
- **THEN** the result SHALL have `kind: "completed"`, variables `{ report: "it crashes", severity: "high", urgent: true }`, and step subagents `["classify", "respond"]`
- **AND** the second step's prompt SHALL be `Write an urgent reply about: it crashes`
