## MODIFIED Requirements

### Requirement: A run is one durable task named agentscript.run
The package SHALL define `AgentScriptRun` with `defineTask`, name `agentscript.run`, version `1`. Its input MUST be a `RunInput` of `{ source: string, options?: StartOptions, model?: ModelRef, scope?: string[], maxSteps?: number }`: `source` the full script text, `options` the `core/step-machine` start options (`entry`, `variables`, `choices`), `model` the pi model every step runs on, with `scope` and `maxSteps` as their requirements say. Its result type MUST be the core `RunResult`.

#### Scenario: The script travels inside the task
- **GIVEN** a task created with input `{ source, options: { entry: ["classify", "gate", "respond"] }, model }`
- **WHEN** the task is later resumed by a process that never read the script file
- **THEN** every phase SHALL read the script from `task.input.source`, and no file access is needed

#### Scenario: Choices travel inside the task
- **GIVEN** a task created with `options: { choices: { next_action: ["retry", "ask"] } }`
- **WHEN** the task is resumed by another process before its judge step
- **THEN** the judge step's `submit_result` parameters SHALL carry `enum: ["retry", "ask"]` on `next_action`

### Requirement: Checkpoints have exactly four phases
The checkpoint SHALL be a `RunCheckpoint` of exactly these shapes; each phase MUST end by committing the next checkpoint or a terminal outcome (`runtime.commit`):
- `{ phase: "next", state: RunState }`
- `{ phase: "dispatch", state: RunState, step: number }`
- `{ phase: "await", state: RunState, step: number, conversationId: ConversationId }`
- `{ phase: "act", state: RunState, intent: null | { replay: "safe" | "unsafe" }, child?, before? }`

`state` is the step machine's `RunState`.

#### Scenario: A two-model-step script walks the phases in order
- **GIVEN** the pipeline script with entries `classify`, `gate` (logic only) and `respond`
- **WHEN** the run proceeds to completion
- **THEN** the committed checkpoints SHALL be, in order: `next` → `dispatch` (step 0) → `await` (step 0) → `next` → `dispatch` (step 1) → `await` (step 1) → `next` → terminal
- **AND** `gate` SHALL produce no checkpoint of its own, because the step machine runs a logic-only subagent inside `next`

#### Scenario: A deterministic subagent walks next, act, next
- **GIVEN** a script whose only entry runs `run_checks`
- **WHEN** the run proceeds to completion
- **THEN** the committed checkpoints SHALL be, in order: `next` → `act` (intent `null`) → `act` (intent recorded) → `next` → terminal

## ADDED Requirements

### Requirement: A run's scope limits the actions it may bind and call
When `scope` is given, the binding check SHALL refuse, with `ActionBindingError` naming the action and `outside this run's scope`, any action the script defines whose tool is not in `scope`, before any step runs. Without `scope`, every registered action is in scope.

#### Scenario: An action outside the scope is refused
- **GIVEN** a run with `scope` `["read_file"]` whose script defines `edit_file`
- **WHEN** the run is started
- **THEN** it SHALL throw `ActionBindingError` naming `edit_file` and `outside this run's scope`

### Requirement: A run stops at its step limit
When `maxSteps` is given and the run's next model step would be step number `maxSteps + 1`, the run SHALL end `failed` without dispatching it, its last step outcome `{ kind: "failed", category: "unknown" }` with a message containing `reached its limit of <maxSteps> steps`.

#### Scenario: The third step is never asked
- **GIVEN** a run with `maxSteps` `2` over a script with three model steps
- **WHEN** it runs on a faux provider
- **THEN** the provider SHALL have been asked exactly twice, and the run SHALL end `failed` with `reached its limit of 2 steps`

### Requirement: A durable host action runs as a child task
A host action MAY be durable: `{ start(inputs, context) → child run input or a failed result, finish(inputs, result, context) → ActionResult }`. The `act` phase SHALL commit the created child's id as `child` (and a workspace snapshot as `before`) in one commit, wait for it idempotently by id, then apply `finish`'s result. Such an action's replay is `"safe"`.

#### Scenario: A durable action's child is created once
- **GIVEN** a durable host action and a run that calls it with `run`
- **WHEN** the run completes
- **THEN** exactly one child task SHALL have been created, and the call's result SHALL be `finish`'s answer for it
