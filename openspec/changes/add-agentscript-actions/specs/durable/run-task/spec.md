## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Checkpoints have exactly three phases
The task's checkpoint SHALL be a `RunCheckpoint`, one of exactly these four shapes, and every phase MUST end by committing the next checkpoint (or a terminal outcome) through `runtime.commit`:
- `{ phase: "next", state: RunState }`
- `{ phase: "dispatch", state: RunState, step: number }`
- `{ phase: "await", state: RunState, step: number, conversationId: ConversationId }`
- `{ phase: "act", state: RunState, intent: null | { replay: "safe" | "unsafe" } }`

`state` is always the `core/step-machine` `RunState`, as plain JSON.

#### Scenario: A two-model-step script walks the phases in order
- **GIVEN** the pipeline script with entries `classify`, `gate` (logic only) and `respond`
- **WHEN** the run proceeds to completion
- **THEN** the committed checkpoints SHALL be, in order: `next` → `dispatch` (step 0) → `await` (step 0) → `next` → `dispatch` (step 1) → `await` (step 1) → `next` → terminal
- **AND** `gate` SHALL produce no checkpoint of its own, because the step machine runs a logic-only subagent inside `next`

#### Scenario: A deterministic subagent walks next, act, next
- **GIVEN** a script whose only entry runs `run_checks`
- **WHEN** the run proceeds to completion
- **THEN** the committed checkpoints SHALL be, in order: `next` → `act` (intent `null`) → `act` (intent recorded) → `next` → terminal

### Requirement: The next phase asks the step machine and either finishes or schedules a dispatch
The `next` phase SHALL call `next(task.input.source, checkpoint.state)` from `core/step-machine` without `persistVariables`, and commit in one transaction:
- `{ type: "done", result }` → the terminal outcome `{ status: "completed", result }`;
- `{ type: "request", state }` → status `running`, checkpoint `{ phase: "dispatch", state, step: state.steps.length }`;
- `{ type: "action", state }` → status `running`, checkpoint `{ phase: "act", state, intent: null }`.

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

### Requirement: A step conversation is configured with the script's system block, the step extension, and only the tools the step needs
Dispatch SHALL call pi-durable's `configure` on the new conversation with:
- `model`: `task.input.model`, only when it is defined;
- `extensions`: `[AgentScriptStepExtension]`;
- `tools`: `submit_result` when the request has an `outputSchema`, plus one tool per `ToolOffer` in `request.tools`, in order, otherwise none;
- `instructions`: the request's `systemInstructions`.

It MUST then set the conversation's `agentscript.step` doc `schema` to the request's `outputSchema`, or `null` when there is none.

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
