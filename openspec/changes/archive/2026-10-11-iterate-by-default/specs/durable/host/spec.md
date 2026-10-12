## MODIFIED Requirements

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
