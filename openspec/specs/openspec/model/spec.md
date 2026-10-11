# openspec/model Specification

## Purpose
The taxonomy of an OpenSpec change: the typed nouns a change is made of, read from its files, including the links from each task to the requirements and scenarios it serves, inferred from prose with how each link was found.

## Requirements

### Requirement: Every model type has a static type and a JSON Schema
The model SHALL declare every type in `openspec/model`, `openspec/process`, `openspec/loops` and `openspec/evidence` once, as a zod schema, with its static type derived by `z.infer` and its JSON Schema by `z.toJSONSchema`. Rules JSON Schema cannot state (one field against another) MUST be refinements on the zod schema. A value crossing a boundary without a compiler (a tool call, a checkpoint, another process) MUST be checkable. The static type may be wider; the check is the authority.

#### Scenario: A schema rejects what the static type rejects
- **GIVEN** the `Clause` type, whose `keyword` is one of `"GIVEN"`, `"WHEN"`, `"THEN"`, `"AND"`
- **WHEN** the value `{ keyword: "BUT", text: "x" }` is checked against the `Clause` schema
- **THEN** the check SHALL fail, as the static type would refuse it

#### Scenario: Every type has a schema
- **WHEN** the set of types the four capabilities define is listed
- **THEN** each SHALL have a zod schema of the same name whose JSON Schema `toJSONSchema` exports without throwing, and no schema SHALL exist without a type

### Requirement: Root locates a planning home
The model SHALL define `Root` as `{ specsDir: string, changesDir: string, schema: string }`, where `specsDir` holds the main specs, `changesDir` holds in-flight and archived changes, and `schema` names the OpenSpec workflow schema in use.

#### Scenario: This repository's root
- **GIVEN** the repository at `~/Projects/agentscript`
- **WHEN** its root is described
- **THEN** it SHALL be `{ specsDir: "openspec/specs", changesDir: "openspec/changes", schema: "spec-driven" }`

### Requirement: A capability is a path, a purpose and its requirements
The model SHALL define `Capability` as `{ path: CapabilityPath, purpose: string, requirements: Requirement[] }` and `CapabilityPath` as a non-empty array of non-empty strings, one per directory segment under `specsDir`. Requirements SHALL keep source order.

#### Scenario: A nested capability path
- **GIVEN** the spec at `openspec/specs/durable/run-task/spec.md`
- **WHEN** it is described as a capability
- **THEN** its `path` SHALL be `["durable", "run-task"]`

#### Scenario: An empty path is not a capability path
- **WHEN** `[]` or `["durable", ""]` is checked as a `CapabilityPath`
- **THEN** the check SHALL fail

### Requirement: A requirement is a name, normative text and its scenarios
The model SHALL define `Requirement` as `{ name: string, text: string, scenarios: Scenario[] }`. `name` is the text after `### Requirement: `; `text` is the body before the first scenario and MUST contain `SHALL` or `MUST`; `scenarios` SHALL be non-empty and keep source order.

#### Scenario: A requirement without a scenario is not a requirement
- **WHEN** `{ name: "x", text: "The system SHALL x.", scenarios: [] }` is checked as a `Requirement`
- **THEN** the check SHALL fail

#### Scenario: Text without a normative keyword is refused
- **WHEN** a `Requirement` whose `text` contains neither `SHALL` nor `MUST` is checked
- **THEN** the check SHALL fail

### Requirement: A scenario is a name and ordered clauses
The model SHALL define `Scenario` as `{ name: string, clauses: Clause[] }` and `Clause` as `{ keyword: "GIVEN" | "WHEN" | "THEN" | "AND", text: string }`. `name` is the text after `#### Scenario: `. `clauses` SHALL be non-empty, keep source order, and contain at least one `WHEN` and one `THEN`.

#### Scenario: A scenario from this repository
- **GIVEN** the scenario `The first and second model steps are numbered 0 and 1` in `durable/run-task`
- **WHEN** it is described
- **THEN** its `clauses` SHALL be one `WHEN` followed by one `THEN`, with the text after each bold keyword

#### Scenario: A scenario with no THEN is refused
- **WHEN** a `Scenario` whose clauses are only `GIVEN` and `WHEN` is checked
- **THEN** the check SHALL fail

### Requirement: A change gathers its artifacts and its state
The model SHALL define `Change` as `{ id: string, schema: string, proposal: Proposal, deltas: Delta[], design?: Design, tasks?: TaskList, state: ChangeState }`. `id` SHALL be kebab-case. `ChangeState` is defined by `openspec/process`.

#### Scenario: A change still being planned
- **GIVEN** a change whose proposal and deltas exist but whose design and tasks do not
- **WHEN** it is described
- **THEN** `design` and `tasks` SHALL be absent, not empty values

#### Scenario: A non-kebab-case id is refused
- **WHEN** a `Change` with `id` `"Add_Thing"` is checked
- **THEN** the check SHALL fail

### Requirement: A proposal states why, what, which capabilities and what not
The model SHALL define `Proposal` as `{ why: string, whatChanges: string[], capabilities: { new: CapabilityPath[], modified: CapabilityPath[] }, outOfScope: string[], impact: string[] }`. A path MUST NOT appear in both `new` and `modified`.

#### Scenario: This change's own proposal
- **GIVEN** the proposal of `add-openspec-ontology`
- **WHEN** it is described
- **THEN** `capabilities.new` SHALL hold `["openspec","model"]`, `["openspec","process"]`, `["openspec","loops"]` and `["openspec","evidence"]`, and `capabilities.modified` SHALL be `[]`

#### Scenario: A path both new and modified is refused
- **WHEN** a `Proposal` lists `["core","subset"]` in both `new` and `modified`
- **THEN** the check SHALL fail

### Requirement: A delta is one of four operations on one capability
The model SHALL define `Delta` as the union of `Added`, `Modified`, `Removed` and `Renamed`, discriminated by `op`, each carrying `capability: CapabilityPath`. `Added` is `{ op: "ADDED", requirement: Requirement }`; `Modified` is `{ op: "MODIFIED", requirement: Requirement }` and replaces the whole requirement of the same name.

#### Scenario: A modified delta carries the whole requirement
- **GIVEN** a `Modified` delta for `pi/cli`
- **WHEN** it is applied to the base capability
- **THEN** the requirement of the same `name` SHALL be replaced entirely by `requirement`, scenarios included

### Requirement: Removal and renaming carry their own fields
The model SHALL define `Removed` as `{ op: "REMOVED", capability, name: string, reason: string, migration: string }` and `Renamed` as `{ op: "RENAMED", capability, from: string, to: string }`. `from` and `to` MUST differ.

#### Scenario: The packaging change removes the tsx bin requirement
- **GIVEN** `package-specsesh-agent`'s delta removing `The bin runs the TypeScript CLI through tsx` from `pi/cli`
- **WHEN** it is described
- **THEN** it SHALL be a `Removed` with that `name` and non-empty `reason` and `migration`

#### Scenario: A rename to the same name is refused
- **WHEN** a `Renamed` with equal `from` and `to` is checked
- **THEN** the check SHALL fail

### Requirement: A design is free-form sections
The model SHALL define `Design` as `{ sections: { heading: string, body: string }[] }`, in source order. The model MUST NOT require particular headings; context, decisions and risks are conventions, not fields.

#### Scenario: A design with custom headings is valid
- **GIVEN** a design whose headings are `Context`, `Two halves` and `Risks and gaps`
- **WHEN** it is checked as a `Design`
- **THEN** the check SHALL pass

### Requirement: A task list is numbered groups of tasks
The model SHALL define `TaskList` as `{ groups: TaskGroup[] }` and `TaskGroup` as `{ number: integer, title: string, tasks: Task[] }`, from a `## <number>. <title>` heading. Group numbers SHALL be positive, unique and ascending in source order.

#### Scenario: A group heading from this repository
- **GIVEN** the heading `## 2. Durable: tests for scenarios with none today` in `baseline-agentscript-durable`'s tasks.md
- **WHEN** it is described
- **THEN** the group SHALL be `{ number: 2, title: "Durable: tests for scenarios with none today", tasks }`

### Requirement: A task has an id, text, a done flag, files and links
The model SHALL define `Task` as `{ id: TaskId, text: string, done: boolean, files: string[], links: TaskLink[] }`. `done` is `true` exactly when the checkbox is `[x]`. `files` lists the backticked paths the text names, in order.

#### Scenario: Task 2.4 of the durable baseline
- **GIVEN** the line `- [x] 2.4 \`packages/agentscript-durable/__tests__/cli.test.ts\`: no command, …`
- **WHEN** it is described
- **THEN** the task SHALL have `id` `"2.4"`, `done` `true` and `files` `["packages/agentscript-durable/__tests__/cli.test.ts"]`

### Requirement: A task id is its group number and its position
The model SHALL define `TaskId` as the string `<group>.<n>`, where `<group>` is the enclosing `TaskGroup.number` and `<n>` a positive integer, matching `^[1-9][0-9]*\.[1-9][0-9]*$`. A task's id MUST start with its own group's number.

#### Scenario: An id outside its group is refused
- **WHEN** a task with id `"3.1"` sits in group `2`
- **THEN** the task list SHALL fail the check

#### Scenario: A malformed id is refused
- **WHEN** `"2"`, `"2.0"` or `"two.1"` is checked as a `TaskId`
- **THEN** the check SHALL fail

### Requirement: A task link targets a requirement or a scenario
The model SHALL define `TaskLink` as `{ target: RequirementRef | ScenarioRef, basis: LinkBasis, confidence: number }`, `RequirementRef` as `{ capability: CapabilityPath, requirement: string }` and `ScenarioRef` as `{ capability, requirement, scenario: string }`. `confidence` SHALL lie in `[0, 1]`.

#### Scenario: A link to a scenario
- **GIVEN** a task naming `Scenario: The first and second model steps are numbered 0 and 1`
- **WHEN** its link is described
- **THEN** `target` SHALL be a `ScenarioRef` with `capability` `["durable","run-task"]`, `requirement` `The step number is the index of the step being run` and that `scenario`

#### Scenario: Confidence outside the unit interval is refused
- **WHEN** a `TaskLink` with `confidence` `1.5` is checked
- **THEN** the check SHALL fail

### Requirement: References serialise to one line of text
The model SHALL serialise a `CapabilityPath` as its segments joined by `/`, a `RequirementRef` as `<path> › <requirement>` and a `ScenarioRef` as `<path> › <requirement> › <scenario>`, with ` › ` (space, U+203A, space) as the separator. Parsing a serialised reference SHALL give back the same reference.

#### Scenario: A scenario reference as text
- **GIVEN** the `ScenarioRef` with `capability` `["durable","run-task"]`, `requirement` `The step number is the index of the step being run` and `scenario` `The first and second model steps are numbered 0 and 1`
- **WHEN** it is serialised
- **THEN** it SHALL read `durable/run-task › The step number is the index of the step being run › The first and second model steps are numbered 0 and 1`

#### Scenario: Round trip
- **WHEN** a serialised `RequirementRef` is parsed and serialised again
- **THEN** the text SHALL be unchanged

### Requirement: A link records how it was inferred, strongest first
The model SHALL define `LinkBasis` as, strongest to weakest: `"scenario-named"` (the text holds a scenario's exact name), `"requirement-named"` (a requirement's exact name), `"capability-named"` (a capability path), `"file-overlap"` (a file another source links to the target), `"inferred"` (anything weaker).

#### Scenario: Bases are ordered
- **WHEN** two links to the same target are compared by basis
- **THEN** a `"scenario-named"` link SHALL rank above a `"requirement-named"` one, and so on down to `"inferred"`

### Requirement: An exact name has confidence 1
A link whose basis is `"scenario-named"` or `"requirement-named"` SHALL have `confidence` `1`. A link with any other basis SHALL have `confidence` below `1`.

#### Scenario: A file-overlap link is less than certain
- **WHEN** a link with basis `"file-overlap"` and `confidence` `1` is checked
- **THEN** the check SHALL fail

#### Scenario: An exact scenario name is certain
- **WHEN** a link with basis `"scenario-named"` and `confidence` `0.8` is checked
- **THEN** the check SHALL fail

### Requirement: An unclaimed scenario is a coverage gap
The model SHALL define an unclaimed scenario as a `ScenarioRef` in some delta of the change that no task links to with basis `"scenario-named"`, or by a `"requirement-named"` link to its requirement. Links of weaker basis MUST NOT claim a scenario.

#### Scenario: A file-overlap link does not claim
- **GIVEN** a delta scenario whose only link is a `"file-overlap"` link from task `1.3`
- **WHEN** unclaimed scenarios are listed
- **THEN** that scenario SHALL be listed

#### Scenario: A requirement-named link claims every scenario of it
- **GIVEN** a task whose text names a requirement with three scenarios
- **WHEN** unclaimed scenarios are listed
- **THEN** none of the three SHALL be listed

### Requirement: Cross-field rules travel with the schema
Every rule that compares one field of a value with another (a task id against its group, a rename's `from` against its `to`, iteration numbering, an answer's `by` against its escalation's `to`) SHALL be a refinement on the zod schema itself, so `schema.safeParse(value)` alone enforces it, and `check` reports it like any other issue.

#### Scenario: safeParse enforces a cross-field rule
- **GIVEN** a `TaskGroup` with `number` `2` holding a task with id `3.1`
- **WHEN** `TaskGroup.safeParse` is called on it, without `check`
- **THEN** it SHALL fail with an issue naming the task id
