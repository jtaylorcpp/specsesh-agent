## MODIFIED Requirements

### Requirement: The bundled group.agent fits the contract and acts on nothing
The package SHALL bundle `group.agent` in `src/task/scripts/`: one reasoning subagent that sets the four read-back variables from a structured result, declares every seeded variable, has no actions, and lints with no diagnostic against the pinned dialect. Its judge SHALL rework first: while reworks remain, reopen the task most likely at fault with sharper feedback; `ask` only for a decision no rework could settle.

#### Scenario: The bundled judge script is clean
- **WHEN** the bundled `group.agent` is analysed and scanned
- **THEN** it SHALL have no diagnostic, no unsupported construct and no action, and pass the judge contract check

#### Scenario: The bundled judge reworks first
- **WHEN** the bundled `group.agent`'s judge step is composed with `rework_count` `1`
- **THEN** its prompt SHALL contain `rework the task most likely at fault` and SHALL NOT contain `Prefer asking`

## ADDED Requirements

### Requirement: The group loop constrains next_action to its contract values
Every judge run the group loop starts SHALL carry `choices: { next_action: ["rework", "ask", "amend-spec"] }`. A group script whose `next_action` default is not one of them MUST be refused at start by the judge contract check, naming the default, before any loop exists.

#### Scenario: The group judge's schema lists the three values
- **WHEN** the bundled `group.agent`'s judge step is dispatched
- **THEN** its `submit_result` parameters SHALL give `next_action` `enum: ["rework", "ask", "amend-spec"]`

#### Scenario: A group default outside the values is refused
- **GIVEN** a group script declaring `next_action: mutable string = "retry"`
- **WHEN** `startGroupLoop` is called with it
- **THEN** it SHALL reject naming `next_action` and `"retry"`, and no loop SHALL be created
