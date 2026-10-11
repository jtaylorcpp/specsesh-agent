## MODIFIED Requirements

### Requirement: A run is one durable task named agentscript.run
The package SHALL define `AgentScriptRun` with `defineTask` under the name `agentscript.run` and version `1`. Its input MUST be a `RunInput` of `{ source: string, options?: StartOptions, model?: ModelRef }`, where `source` is the full Agent Script text, `options` are the `core/step-machine` start options (`entry`, `variables`, `choices`), and `model` is the pi model every step runs on. Its result type MUST be the core `RunResult`.

#### Scenario: The script travels inside the task
- **GIVEN** a task created with input `{ source, options: { entry: ["classify", "gate", "respond"] }, model }`
- **WHEN** the task is later resumed by a process that never read the script file
- **THEN** every phase SHALL read the script from `task.input.source`, and no file access is needed

#### Scenario: Choices travel inside the task
- **GIVEN** a task created with `options: { choices: { next_action: ["retry", "ask"] } }`
- **WHEN** the task is resumed by another process before its judge step
- **THEN** the judge step's `submit_result` parameters SHALL carry `enum: ["retry", "ask"]` on `next_action`

## ADDED Requirements

### Requirement: checkResult refuses a value outside a property's enum
For an object value, `checkResult` SHALL also add `"<field>" must be one of <each value JSON-quoted, joined by ", ">, got <the value JSON-quoted>` for every property with an `enum` whose present value is not in it. This problem SHALL join the others in the one `The result was not recorded: … Call again.` message.

#### Scenario: Prose in an enum field is refused
- **GIVEN** a schema whose `next_action` is `{ type: "string", enum: ["retry", "amend-spec", "ask"] }`
- **WHEN** `checkResult` is called with `{ next_action: "retry. Both questions can be settled" }`
- **THEN** the message SHALL contain `"next_action" must be one of "retry", "amend-spec", "ask", got "retry. Both questions can be settled"`
- **AND** it SHALL end with `Call again.`

#### Scenario: A value in the enum passes
- **WHEN** `checkResult` is called on that schema with `{ next_action: "ask" }`
- **THEN** it SHALL return `undefined`
