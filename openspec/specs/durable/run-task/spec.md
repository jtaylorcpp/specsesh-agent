# durable/run-task Specification

## Purpose
Agent Script as a pi-durable extension: one agentscript.run task per run, checkpointed after every phase, with each model step in its own task-owned conversation, so a run survives eviction and crashes.

## Requirements

### Requirement: The package exports two pi-durable extensions
`@specsesh/agent/durable` SHALL export `AgentScript`, an extension named `agentscript` whose only task is `AgentScriptRun`, and `AgentScriptStepExtension`, an extension named `agentscript.step` carrying exactly one section (`result`) and exactly one tool (`submit_result`). A host MUST install both into the pi-durable registry it opens the harness with; the package registers nothing on its own.

#### Scenario: A host installs both extensions
- **GIVEN** a registry from `createRegistry()`
- **WHEN** the host calls `registry.install(AgentScript)` and `registry.install(AgentScriptStepExtension)` and opens a `Harness` with that registry
- **THEN** a task of name `agentscript.run` can be created through that harness
- **AND** step conversations configured by that task can select the `agentscript.step` extension

#### Scenario: The result tool name is a stable export
- **WHEN** a caller reads `RESULT_TOOL` from `@specsesh/agent/durable`
- **THEN** it SHALL equal `"submit_result"`, the name the step's tool is registered under

### Requirement: A run is one durable task named agentscript.run
The package SHALL define `AgentScriptRun` with `defineTask` under the name `agentscript.run` and version `1`. Its input MUST be a `RunInput` of `{ source: string, options?: StartOptions, model?: ModelRef }`, where `source` is the full Agent Script text, `options` are the `core/step-machine` start options (`entry`, `variables`), and `model` is the pi model every step runs on. Its result type MUST be the core `RunResult`.

#### Scenario: The script travels inside the task
- **GIVEN** a task created with input `{ source, options: { entry: ["classify", "gate", "respond"] }, model }`
- **WHEN** the task is later resumed by a process that never read the script file
- **THEN** every phase SHALL read the script from `task.input.source`, and no file access is needed

### Requirement: The initial checkpoint is the step machine's first state
The task's `initial` function SHALL return the checkpoint `{ phase: "next", state: start(input.source, input.options) }`. Because `start` runs when the task is created, every refusal the `core/step-machine` and `core/subset` capabilities define (lint errors, unsupported constructs, undeclared variables or overrides, unknown or empty entries) MUST throw at task creation, before any task row exists and before any model request.

#### Scenario: A script outside the subset is refused at creation
- **GIVEN** a script that adds a top-level `model_config:` block
- **WHEN** a host calls `startScript` with it
- **THEN** the call SHALL reject with an error whose message contains `unsupported by this runtime`
- **AND** no model request SHALL have been made

#### Scenario: A valid script creates a task at phase next
- **WHEN** a host creates the task for a valid script
- **THEN** the stored checkpoint SHALL be `{ phase: "next", state }` where `state` has `cursor: 0`, `steps: []`, no `awaiting`, and the authored variable values with overrides applied

### Requirement: Checkpoints have exactly four phases
The checkpoint SHALL be a `RunCheckpoint` of exactly these shapes; each phase MUST end by committing the next checkpoint or a terminal outcome via `runtime.commit`:
- `{ phase: "next", state: RunState }`
- `{ phase: "dispatch", state: RunState, step: number }`
- `{ phase: "await", state: RunState, step: number, conversationId: ConversationId }`
- `{ phase: "act", state: RunState, intent: null | { replay: "safe" | "unsafe" } }`

`state` is the `core/step-machine` `RunState`, as plain JSON.

#### Scenario: A two-model-step script walks the phases in order
- **GIVEN** the pipeline script with entries `classify`, `gate` (logic only) and `respond`
- **WHEN** the run proceeds to completion
- **THEN** the committed checkpoints SHALL be, in order: `next` → `dispatch` (step 0) → `await` (step 0) → `next` → `dispatch` (step 1) → `await` (step 1) → `next` → terminal
- **AND** `gate` SHALL produce no checkpoint of its own, because the step machine runs a logic-only subagent inside `next`

#### Scenario: A deterministic subagent walks next, act, next
- **GIVEN** a script whose only entry runs `run_checks`
- **WHEN** the run proceeds to completion
- **THEN** the committed checkpoints SHALL be, in order: `next` → `act` (intent `null`) → `act` (intent recorded) → `next` → terminal

### Requirement: The step number is the index of the step being run
A checkpoint's `step` SHALL be the zero-based index of the step being run, equal to `state.steps.length` at the moment `next` produced the request. It MUST stay the same through that step's `dispatch` and `await` phases.

#### Scenario: The first and second model steps are numbered 0 and 1
- **WHEN** the pipeline run dispatches `classify` and then `respond`
- **THEN** their checkpoints SHALL carry `step: 0` and `step: 1`

### Requirement: The next phase asks the step machine and either finishes or schedules a dispatch
The `next` phase SHALL call `next(task.input.source, checkpoint.state)` without `persistVariables` and commit, in one transaction:
- `done` → terminal `{ status: "completed", result }`;
- `request` → `running`, `{ phase: "dispatch", state, step: state.steps.length }`;
- `action` → `running`, `{ phase: "act", state, intent: null }`.

The phase MUST make no model request, create no conversation and execute no action.

#### Scenario: A completed task carries no rewritten source
- **WHEN** a run ends through the `next` phase
- **THEN** its `result` SHALL have no `updatedSource`

#### Scenario: A finished machine ends the task completed
- **GIVEN** a checkpoint at phase `next` whose state has every entry consumed
- **WHEN** the phase runs
- **THEN** the task SHALL become terminal with outcome `{ status: "completed", result }` where `result.kind` is `"completed"`

#### Scenario: A request moves the task to dispatch
- **GIVEN** a checkpoint at phase `next` for a fresh pipeline run
- **WHEN** the phase runs
- **THEN** the checkpoint SHALL become `{ phase: "dispatch", step: 0, state }` with `state.awaiting.subagent` equal to `"classify"`

#### Scenario: An action call moves the task to act
- **GIVEN** a checkpoint at phase `next` whose state reaches a `run`
- **WHEN** the phase runs
- **THEN** the checkpoint SHALL become `{ phase: "act", state, intent: null }` with `state.awaiting.call` set, and no host action SHALL have executed

### Requirement: A run that ends failed or cut short still completes the task
A run whose last step settled `failed` or `cut-short` SHALL end the task with outcome status `completed`, carrying a `RunResult` whose `kind` is `"failed"` or `"cut-short"`. The pi-durable task outcome status MUST describe the task, and `RunResult.kind` MUST describe the script; a step failure is never a task error.

#### Scenario: A provider error ends the run failed inside a completed task
- **GIVEN** the pipeline run with a structured answer queued for `classify` and nothing queued for `respond`
- **WHEN** the run settles
- **THEN** the task outcome status SHALL be `completed`
- **AND** `result.kind` SHALL be `"failed"`, with step outcome kinds `["answered", "failed"]`
- **AND** `result.variables` SHALL keep `severity: "high"` and `urgent: true` from the steps that finished

### Requirement: The dispatch phase creates one fresh task-owned conversation per step in one commit
The `dispatch` phase SHALL read `checkpoint.state.awaiting.request` and, inside a single `runtime.commit`, create a new conversation with ownership `{ kind: "task", taskId: runtime.taskId }`, configure it, and commit checkpoint `{ phase: "await", state, step, conversationId: <new id> }`. If `state.awaiting` is absent the phase MUST throw `dispatch reached with no step awaiting`.

#### Scenario: A crash during dispatch leaves no orphan conversation
- **GIVEN** a process that dies while the dispatch phase runs
- **WHEN** the run resumes
- **THEN** the stored state SHALL be either phase `dispatch` with no new conversation, or phase `await` naming the new conversation, because creation and the checkpoint are one commit

#### Scenario: Each step gets its own conversation
- **WHEN** the pipeline run dispatches `classify` and later `respond`
- **THEN** each SHALL run in a distinct conversation owned by the run task

#### Scenario: Dispatch with nothing awaiting is an error
- **GIVEN** a checkpoint at phase `dispatch` whose `state.awaiting` is undefined
- **WHEN** the phase runs
- **THEN** it SHALL throw an error with message `dispatch reached with no step awaiting`

### Requirement: A step conversation is configured with the script's system block, the step extension, and only the tools the step needs
Dispatch SHALL call pi-durable's `configure` on the new conversation with:
- `model`: `task.input.model`, only when it is defined;
- `extensions`: `[AgentScriptStepExtension]`;
- `tools`: `submit_result` if the request has an `outputSchema`, then one tool per `ToolOffer`, in order;
- `instructions`: the request's `systemInstructions`.

It MUST then set the `agentscript.step` doc's `schema` to the `outputSchema`, or `null`.

#### Scenario: A structured step offers the result tool
- **GIVEN** the `classify` step, which writes `@variables.severity` from `@outputs.severity`
- **WHEN** its model request is made
- **THEN** the tools offered SHALL be exactly `["submit_result"]`
- **AND** the system prompt SHALL carry an `instructions` section containing the script's `system.instructions` text

#### Scenario: A text-only step offers no tool
- **GIVEN** the `respond` step, which has no `@outputs` assignment
- **WHEN** its model request is made
- **THEN** the tools offered SHALL be exactly `[]`
- **AND** there SHALL be no `result` section

#### Scenario: Without a model in the input, no model is configured
- **GIVEN** a task input with no `model`
- **WHEN** a step conversation is configured
- **THEN** `configure` SHALL be called without a `model` key, leaving model selection to pi-durable's defaults for a new task-owned conversation

#### Scenario: A step with reasoning actions offers its action tools
- **GIVEN** the default task script's `act` step
- **WHEN** its model request is made
- **THEN** the tools offered SHALL be exactly `["read", "edit", "shell"]`, with no `submit_result`

### Requirement: A step sees only the system block, its own prompt, and the result tool
A step's model request SHALL contain the script's system instructions as their own system section (never inside a user message), exactly one user message holding that step's composed prompt, and no tools other than `submit_result` and the step's own offered action tools. Nothing from an earlier step's conversation MUST appear in a later step's request; information passes between steps only through script variables.

#### Scenario: The second step does not see the first step's prompt
- **GIVEN** the pipeline run answering `classify` with `{ severity: "low" }` and `respond` with text
- **WHEN** both model requests are inspected
- **THEN** the user messages SHALL be exactly `["Classify: it crashes"]` and `["Write a routine reply about: it crashes"]`
- **AND** the `respond` request SHALL NOT contain the text `Classify:`
- **AND** no user message SHALL contain `You triage bug reports.`

### Requirement: The await phase submits the prompt idempotently and folds the answer into the machine
The `await` phase SHALL open the step conversation by `checkpoint.conversationId`, submit `{ type: "input", content: request.prompt, requestId: "agentscript:<taskId>:<step>" }`, wait for it to settle, convert it to a `StepOutcome`, call `apply(task.input.source, state, outcome)` from `core/step-machine`, and commit checkpoint `{ phase: "next", state: <applied state> }`. If `state.awaiting` is absent the phase MUST throw `await reached with no step awaiting`.

#### Scenario: A re-run await phase does not start a second model turn
- **GIVEN** a process that died after submitting a step's prompt and before committing the next checkpoint
- **WHEN** the await phase runs again in a new process
- **THEN** it SHALL submit with the same `requestId`, and pi-durable SHALL return the existing submission rather than a new one

#### Scenario: The request ID names the task and step
- **GIVEN** task 7 at phase `await` with `step: 1`
- **WHEN** the phase submits
- **THEN** the submission's `requestId` SHALL be `agentscript:7:1`

#### Scenario: Await with nothing awaiting is an error
- **GIVEN** a checkpoint at phase `await` whose `state.awaiting` is undefined
- **WHEN** the phase runs
- **THEN** it SHALL throw an error with message `await reached with no step awaiting`

### Requirement: A step that was not answered maps to a failed outcome
The await phase SHALL map a step that was not answered to a failed `StepOutcome` with category `unknown`:
- the step conversation cannot be opened → message `step conversation <id> is missing`;
- the submission settles with status other than `done`, or with no `answer` → message `the step was not answered: <reason, else status>`, with ` (<JSON of detail>)` appended when the settlement carries a `detail`.

#### Scenario: A provider error settles as a failed step
- **GIVEN** a step whose model request errors
- **WHEN** the submission settles with a status other than `done`
- **THEN** the step outcome SHALL be `failed` with category `unknown` and a message starting `the step was not answered:`

#### Scenario: A missing step conversation is a failed step
- **GIVEN** a checkpoint at phase `await` whose `conversationId` names no conversation
- **WHEN** the phase runs
- **THEN** the step outcome SHALL be `failed` with category `unknown` and message `step conversation <id> is missing`

### Requirement: An answered step's text and structured result come from different places
An answered submission SHALL map to `{ kind: "answered", text }`, plus `structured: <step doc result>` only when the request had an `outputSchema` and the `agentscript.step` doc's `result` is not null. `text` MUST be the concatenation of the `text` blocks of the assistant messages in the answer entry of the step conversation's context, tool-call blocks skipped. The structured result MUST come from the step doc, never from the text.

#### Scenario: A structured step answers with the doc's result
- **GIVEN** the model calls `submit_result` with `{ severity: "high" }` and the call is accepted
- **WHEN** the step settles
- **THEN** the outcome SHALL be `answered` with `structured` equal to `{ severity: "high" }`

#### Scenario: A text answer to a structured step carries no structured result
- **GIVEN** the `classify` step and a model that answers only the text `severity: high`
- **WHEN** the step settles
- **THEN** the outcome passed to `apply` SHALL be `answered` with no `structured`
- **AND** the run SHALL end with `kind: "failed"`, one step, and `severity` still `""`, because `core/step-machine` treats a missing structured result as a failure and never reads prose

#### Scenario: A text step's text is the assistant's text blocks
- **GIVEN** the `respond` step answered with the text `On it, urgently.`
- **WHEN** the step settles
- **THEN** the step outcome SHALL equal `{ kind: "answered", text: "On it, urgently." }`

### Requirement: The agentscript.step doc holds each step's schema and accepted result
`@specsesh/agent/durable` SHALL export `AgentScriptStep`, defined with `defineDoc` as kind `agentscript.step`, version `1`, scope `conversation`, history `latest`, fork `initial`, and initial value `{ schema: null, result: null, refusals: 0 }`. `schema` MUST be the step's JSON Schema or `null` for a text-only step; `result` MUST be `null` until `submit_result` accepts a result, and then the accepted object.

#### Scenario: A fresh step conversation starts empty and gets its schema at dispatch
- **WHEN** dispatch configures a structured step
- **THEN** the doc SHALL read `{ schema: <the request's outputSchema>, result: null, refusals: 0 }` before the model is called

#### Scenario: A text-only step's doc has no schema
- **WHEN** dispatch configures a text-only step
- **THEN** the doc SHALL read `{ schema: null, result: null, refusals: 0 }`

### Requirement: submit_result records an accepted result or hands the problem back
On each call `submit_result` SHALL read the conversation's `agentscript.step` doc and call `checkResult(doc.schema, args)`:
- a problem string → return that text with `isError: true`, write only the incremented `refusals`, and leave the step running for another call, unless it was the third refusal;
- no problem → commit `doc.result = args` and return the text `Result recorded.` with `control: { terminate: true }`, ending the step's turn.

#### Scenario: A bad result is handed back and the model retries within the same step
- **GIVEN** the `classify` step and a model that first calls `submit_result` with `{ severity: 3 }`, then with `{ severity: "high" }`
- **WHEN** the run completes
- **THEN** the second model request SHALL contain the error text `"severity" must be a string, got number`
- **AND** `result.variables.severity` SHALL be `"high"`
- **AND** the run SHALL have made exactly three model requests in total (two for `classify`, one for `respond`)

#### Scenario: An accepted result ends the step
- **WHEN** the model calls `submit_result` with a result that passes `checkResult`
- **THEN** the tool SHALL return `Result recorded.` with `control.terminate` true
- **AND** the step doc's `result` SHALL equal the submitted arguments

### Requirement: The result section shows the schema only on structured steps
`AgentScriptStepExtension` SHALL contribute a system-prompt section named `result`. When the conversation's `agentscript.step` doc has a non-null `schema`, the section text MUST be `Finish by calling submit_result with an object matching this JSON Schema:` followed by a newline and the schema as two-space-indented JSON. When the schema is null or the doc is absent, the section MUST be omitted.

#### Scenario: The classify step's prompt shows its schema
- **WHEN** the `classify` step's model request is made
- **THEN** the `result` section SHALL contain `"severity"`

#### Scenario: The respond step has no result section
- **WHEN** the `respond` step's model request is made
- **THEN** there SHALL be no `result` section

### Requirement: checkResult refuses a result with no schema or no object
`@specsesh/agent/durable` SHALL export `checkResult(schema, value): string | undefined`, returning `undefined` when the value is acceptable and otherwise one message for the model. When `schema` is `null` it MUST return `This step takes no structured result; answer in text instead.`; when `value` is `null`, not an object, or an array it MUST return `The result must be an object.`

#### Scenario: A non-object result is refused
- **WHEN** `checkResult` is called on a schema with `null`, `"high"`, `3` or `["high"]`
- **THEN** it SHALL return `The result must be an object.`

#### Scenario: A text-only step refuses any result
- **WHEN** `checkResult(null, { a: 1 })` is called
- **THEN** the message SHALL contain `takes no structured result`

### Requirement: checkResult names every missing field and wrong type at once
For an object value, `checkResult` SHALL add `missing "<field>"` for every field in `schema.required` (or every key of `schema.properties` when `required` is absent) not present in the value, and `"<field>" must be a <type>, got <typeof>` for every property with a declared `type` present with a different `typeof`. Any problems MUST produce `The result was not recorded: <problems joined by "; ">. Call again.` Fields the schema does not name MUST NOT be rejected.

#### Scenario: A complete, well-typed result passes
- **GIVEN** a schema requiring `severity` (string), `score` (number) and `ok` (boolean)
- **WHEN** `checkResult` is called with `{ severity: "high", score: 2, ok: true }`
- **THEN** it SHALL return `undefined`

#### Scenario: Every missing field and wrong type is named at once
- **WHEN** `checkResult` is called on that schema with `{ score: "2", ok: true }`
- **THEN** the message SHALL contain `missing "severity"` and `"score" must be a number, got string`
- **AND** it SHALL end with `Call again.`

#### Scenario: An extra field is not refused
- **WHEN** `checkResult` is called with `{ severity: "high", score: 2, ok: true, extra: 1 }`
- **THEN** it SHALL return `undefined`

#### Scenario: A null field value is a wrong type
- **WHEN** `checkResult` is called with `{ severity: null, score: 2, ok: true }`
- **THEN** the message SHALL contain `"severity" must be a string, got object`

### Requirement: Aborting a run ends the task aborted
The task's `abort` handler SHALL commit the terminal outcome `{ status: "aborted", reason: "aborted" }`.

#### Scenario: A run aborted before its first answer
- **GIVEN** a pipeline run with no model responses queued
- **WHEN** the host calls `harness.abortTask(id)`
- **THEN** the call SHALL report `marked` or `terminal`
- **AND** `waitForScript` SHALL reject with a message matching `ended aborted`

### Requirement: A run survives its process dying and resumes from the last commit
Because every phase ends in one commit, the await phase's submission is idempotent by request ID, and the act phase records intent before executing, a run on durable pi-durable storage SHALL resume after the process dies at any point and finish without re-running a committed step or action, and without silently re-running an `unsafe` action. A resumed process MUST need only the same storage, a registry with both extensions installed, and a models collection; it MUST NOT need the script file.

#### Scenario: A crash during the second model request resumes at the second step
- **GIVEN** the pipeline run on a Node SQLite file, `classify` answered with `{ severity: "high" }`, and the process exiting with code 137 when the `respond` model request starts
- **WHEN** a fresh process opens the same file with only `respond`'s answer (`Escalated.`) queued and calls `harness.resume()`
- **THEN** the run SHALL complete with variables `{ report: "it crashes", severity: "high", urgent: true }`
- **AND** step subagents SHALL be `["classify", "respond"]`, with `classify`'s outcome `answered` carrying `structured: { severity: "high" }`
- **AND** the resumed process SHALL make exactly one model request, whose content contains `Write an urgent reply about: it crashes`

#### Scenario: A crash during the very first model request resumes and runs every step
- **GIVEN** the pipeline run on a Node SQLite file and the process exiting with code 137 when the first model request starts
- **WHEN** a fresh process opens the same file with answers for both model steps queued and resumes
- **THEN** the run SHALL complete with variables `{ report: "it crashes", severity: "low", urgent: false }`
- **AND** the resumed process SHALL make exactly two model requests

#### Scenario: A crash during an unsafe action is reported, not repeated
- **GIVEN** a run whose `run_checks` call (replay `unsafe`) was executing when the process exited with code 137
- **WHEN** a fresh process resumes it
- **THEN** `run_checks` SHALL NOT execute again, and the run SHALL end `failed` with an action report whose message says it was interrupted and not re-run

#### Scenario: A crash during a safe action re-runs it
- **GIVEN** a run whose `edit_file` call (replay `safe`) was executing when the process exited with code 137
- **WHEN** a fresh process resumes it
- **THEN** `edit_file` SHALL execute again with the same inputs, and the run SHALL continue

### Requirement: The act phase executes one action call with its intent recorded first
The `act` phase SHALL, with `intent` `null`, look up the call's tool in the host's `ActionRegistry` and commit `intent: { replay }` from that action's policy before executing anything. It SHALL then execute the action once in the configured workspace and commit `{ phase: "next", state: applyAction(source, state, result) }`. An action that throws SHALL become `{ ok: false, message }`.

#### Scenario: Intent is committed before execution
- **GIVEN** a checkpoint at `act` with `intent` `null`
- **WHEN** the phase runs
- **THEN** a commit with `intent` `{ replay: "unsafe" }` SHALL precede the first call to `run_checks`' executor

#### Scenario: A throwing action becomes a failed result
- **WHEN** the executor throws `Error("boom")`
- **THEN** the call SHALL be applied as `{ ok: false, message: "boom" }` and the run SHALL end `failed`

### Requirement: An interrupted action follows its replay policy
On resume at `act` with `intent` already recorded, the phase SHALL re-execute the call when `intent.replay` is `"safe"`, and SHALL NOT execute it when `"unsafe"`, applying `{ ok: false, message: "<action> was interrupted and not re-run" }` instead. This is pi-durable's tool replay rule, applied to deterministic calls.

#### Scenario: An unsafe interrupted call is not executed on resume
- **GIVEN** a checkpoint at `act` with `intent` `{ replay: "unsafe" }` for `run_command`
- **WHEN** the phase runs
- **THEN** the executor SHALL NOT be called, and the result applied SHALL say `run_command was interrupted and not re-run`

### Requirement: Offered action tools run as pi-durable tools with their replay policy
Each `ToolOffer` SHALL be registered on the step conversation as a pi-durable tool named `offer.name`, with `parameters` `offer.inputSchema` and `replay` the action's policy. Executing it SHALL merge `offer.bound` into the model's arguments, run the host action in the workspace, and return its outputs as JSON content; `{ ok: false }` SHALL return an error result the model sees and may act on.

#### Scenario: Bound inputs are merged into the call
- **GIVEN** an offer `note` bound to `path` `"NOTES.md"`
- **WHEN** the model calls `note` with `{ content: "x" }`
- **THEN** `edit_file` SHALL execute with `{ path: "NOTES.md", content: "x" }`

#### Scenario: A refused command is an error the model sees
- **GIVEN** the entry `shell` carries `set @variables.last_exit = @outputs.exit_code`
- **WHEN** the model calls `shell` with a command whose first word is not allowlisted
- **THEN** the tool result SHALL be an error naming the allowlist, and the step SHALL continue
- **AND** the call SHALL be reported with `ok` false, `last_exit` SHALL keep its value, and the step SHALL end answered

### Requirement: A step's tool calls reach the machine in call order
When a step with offered tools settles answered, the await phase SHALL read every action tool call in the step conversation, in call order, and report them as the outcome's `toolCalls`: `name`, the merged `inputs`, `ok` (false for an error result), the host's `outputs` (`{}` for an error result), and the host's `record`. Calls to `submit_result` SHALL NOT be listed.

#### Scenario: Two shell calls are reported
- **GIVEN** an `act` step in which the model called `shell` twice and then answered
- **WHEN** the await phase folds the answer in
- **THEN** the outcome's `toolCalls` SHALL hold two `shell` entries, in order, with `ok` true and their outputs

### Requirement: The result tool's parameters are the step's schema
On a structured step, the offered `submit_result` SHALL have `parameters` equal to the request's `outputSchema`, `replay: "safe"` and the description `Submit this step's result as an object with exactly the fields the system prompt lists. Call it once; it ends the step.` Every call MUST reach the tool, which checks the arguments as sent (bypassing pi's validation and coercion) with `checkResult` against the doc's `schema`.

#### Scenario: The provider sees the step's types
- **GIVEN** a judge step whose schema wants `met` as a boolean
- **WHEN** its conversation is dispatched
- **THEN** the offered `submit_result` tool's `parameters` SHALL be that schema, with `met` of type `boolean`

#### Scenario: A wrongly typed field still reaches the tool's own check
- **WHEN** a provider ignores the parameters and calls `submit_result` with `{ severity: 3 }` on a step whose schema wants a string
- **THEN** pi SHALL execute the tool, and the tool SHALL produce the refusal

#### Scenario: A call pi's own validation would refuse is the tool's refusal
- **WHEN** the model calls `submit_result` on the judge step with `{}`, then with `met: "yes"`
- **THEN** each SHALL come back as the tool's refusal text, not pi's validation error, and `refusals` SHALL be `2`

### Requirement: Refused results are bounded per step
The `agentscript.step` doc SHALL count refused `submit_result` calls in `refusals`, starting at `0`. The third refusal in one step MUST end the step: the step settles `{ kind: "failed", category: "unknown" }` with a message naming the count and the last problem, and no further model request is made for it.

#### Scenario: A model that never fixes its result stops after three tries
- **GIVEN** a provider that answers every judge request with `submit_result` `{ met: "true", unmet: "", next_action: "proceed", question: "done" }`
- **WHEN** the step runs
- **THEN** the provider SHALL have been asked exactly 3 times
- **AND** the step SHALL be failed, category `unknown`, with a message containing `refused 3 times` and `"met" must be a boolean`
