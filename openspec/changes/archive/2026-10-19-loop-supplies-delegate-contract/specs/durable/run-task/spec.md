## MODIFIED Requirements

### Requirement: A run is one durable task named agentscript.run
The package SHALL define `AgentScriptRun` with `defineTask`, name `agentscript.run`, version `1`. Its input MUST be a `RunInput` of `{ source: string, options?: StartOptions, model?: ModelRef, scope?: string[], maxSteps?: number, delegatePreamble?: string }`: `source` the full script text, `options` the `core/step-machine` start options (`entry`, `variables`, `choices`), `model` the pi model every step runs on, the rest as their requirements say. Its result type MUST be the core `RunResult`.

#### Scenario: The script travels inside the task
- **GIVEN** a task created with input `{ source, options: { entry: ["classify", "gate", "respond"] }, model }`
- **WHEN** the task is later resumed by a process that never read the script file
- **THEN** every phase SHALL read the script from `task.input.source`, and no file access is needed

#### Scenario: Choices travel inside the task
- **GIVEN** a task created with `options: { choices: { next_action: ["retry", "ask"] } }`
- **WHEN** the task is resumed by another process before its judge step
- **THEN** the judge step's `submit_result` parameters SHALL carry `enum: ["retry", "ask"]` on `next_action`

## ADDED Requirements

### Requirement: A run hands its delegate preamble to the actions it runs
When `RunInput.delegatePreamble` is set, the `act` phase SHALL pass it, read from the task's input, as `ActionContext.delegatePreamble` to every action it calls with `run`, executed or durable. A step's tool calls SHALL get none. Without it, no action SHALL get one. A script can neither read nor set it.

#### Scenario: A delegate preamble travels inside the task
- **GIVEN** a run created with `delegatePreamble` `"P"` whose script calls a durable delegate with `run`, and a process that dies before that call
- **WHEN** a fresh harness resumes the run
- **THEN** the delegate's `start` SHALL receive `delegatePreamble` `"P"` in its context

#### Scenario: A step's tool call gets no preamble
- **GIVEN** a run created with `delegatePreamble` `"P"` whose step is offered a host action as a reasoning action
- **WHEN** the model calls that tool
- **THEN** the action's context SHALL have no `delegatePreamble`

#### Scenario: A run without a preamble passes none
- **GIVEN** a run created without `delegatePreamble` whose script calls an action with `run`
- **WHEN** the action executes
- **THEN** its context SHALL have no `delegatePreamble`
