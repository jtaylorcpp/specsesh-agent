## MODIFIED Requirements

### Requirement: Every model type has a static type and a JSON Schema
The model SHALL declare every type in `openspec/model`, `openspec/process`, `openspec/loops` and `openspec/evidence` once, as a TypeBox schema (itself a JSON Schema), its static type derived by `Static`. Rules JSON Schema cannot state (one field against another) MUST be refinements on that schema. A value crossing a boundary without a compiler (a tool call, a checkpoint, another process) MUST be checkable. The static type may be wider; the check is the authority.

#### Scenario: A schema rejects what the static type rejects
- **GIVEN** the `Clause` type, whose `keyword` is one of `"GIVEN"`, `"WHEN"`, `"THEN"`, `"AND"`
- **WHEN** the value `{ keyword: "BUT", text: "x" }` is checked against the `Clause` schema
- **THEN** the check SHALL fail, as the static type would refuse it

#### Scenario: Every type has a schema
- **WHEN** the set of types the four capabilities define is listed
- **THEN** each SHALL have a TypeBox schema of the same name whose JSON Schema `toJSONSchema` returns as plain, serialisable JSON, and no schema SHALL exist without a type

## REMOVED Requirements

### Requirement: Cross-field rules travel with the schema
**Reason**: Its scenario named zod's `safeParse`; the ontology is TypeBox again.
**Migration**: See "Cross-field rules are part of the schema's own check".

## ADDED Requirements

### Requirement: Cross-field rules are part of the schema's own check
Every rule that compares one field of a value with another (a task id against its group, a rename's `from` against its `to`, iteration numbering, an answer's `by` against its escalation's `to`) SHALL be a refinement on the schema itself, so the schema library's own check (`Value.Check`) alone enforces it, and `check` reports it like any other issue.

#### Scenario: The schema's own check enforces a cross-field rule
- **GIVEN** a `TaskGroup` with `number` `2` holding a task with id `3.1`
- **WHEN** it is checked with `Value.Check(TaskGroup, value)`, without `check`
- **THEN** it SHALL fail, and `explain(TaskGroup, value)` SHALL name the task id
