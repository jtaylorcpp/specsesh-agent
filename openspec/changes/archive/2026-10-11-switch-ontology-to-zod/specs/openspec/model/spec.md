## MODIFIED Requirements

### Requirement: Every model type has a static type and a JSON Schema
The model SHALL declare every type in `openspec/model`, `openspec/process`, `openspec/loops` and `openspec/evidence` once, as a zod schema, with its static type derived by `z.infer` and its JSON Schema by `z.toJSONSchema`. Rules JSON Schema cannot state (one field against another) MUST be refinements on the zod schema. A value crossing a boundary without a compiler (a tool call, a checkpoint, another process) MUST be checkable. The static type may be wider; the check is the authority.

#### Scenario: A schema rejects what the static type rejects
- **GIVEN** the `Clause` type, whose `keyword` is one of `"GIVEN"`, `"WHEN"`, `"THEN"`, `"AND"`
- **WHEN** the value `{ keyword: "BUT", text: "x" }` is checked against the `Clause` schema
- **THEN** the check SHALL fail, as the static type would refuse it

#### Scenario: Every type has a schema
- **WHEN** the set of types the four capabilities define is listed
- **THEN** each SHALL have a zod schema of the same name whose JSON Schema `toJSONSchema` exports without throwing, and no schema SHALL exist without a type

## ADDED Requirements

### Requirement: Cross-field rules travel with the schema
Every rule that compares one field of a value with another (a task id against its group, a rename's `from` against its `to`, iteration numbering, an answer's `by` against its escalation's `to`) SHALL be a refinement on the zod schema itself, so `schema.safeParse(value)` alone enforces it, and `check` reports it like any other issue.

#### Scenario: safeParse enforces a cross-field rule
- **GIVEN** a `TaskGroup` with `number` `2` holding a task with id `3.1`
- **WHEN** `TaskGroup.safeParse` is called on it, without `check`
- **THEN** it SHALL fail with an issue naming the task id
