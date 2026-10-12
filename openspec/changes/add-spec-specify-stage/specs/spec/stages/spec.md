## ADDED Requirements

### Requirement: The specs stage derives deltas from the approved design
The task entry SHALL export `specsStage`, named `specs`, owning `specs/`, after `design`, with the bundled `spec-specify.agent`. Its seed SHALL set `approved` to `proposal.md`, `design.md` and every file under `design/` as `=== ` sections, and `base` to the full spec of each capability the proposal modifies.

#### Scenario: The specs stage sees the mock and examples
- **GIVEN** an approved design with `design/mock.html` and `design/examples/a.ts`
- **WHEN** the specs stage's seed runs
- **THEN** `approved` SHALL hold sections for `proposal.md`, `design.md`, `design/mock.html` and `design/examples/a.ts`

### Requirement: Strict validation is the specs gate's first rule
The gate SHALL run `openspec validate <change> --strict --json` in the workspace with `OPENSPEC_TELEMETRY=0`, reporting each issue at its own level and path. A command that cannot run or prints no parseable JSON SHALL be one `ERROR` naming the command.

#### Scenario: An OpenSpec error reaches the next draft
- **WHEN** `openspec validate` reports `Requirement must have at least one scenario` for `specs/plan/export/spec.md`
- **THEN** the gate SHALL report that message as an `ERROR` with that path

#### Scenario: openspec is missing
- **WHEN** `openspec` cannot be spawned
- **THEN** the gate SHALL report one `ERROR` naming `openspec validate`

### Requirement: The deltas cover exactly the proposal's capabilities
The gate SHALL report an `ERROR` for each capability the approved proposal names without a delta file, for each delta file of a capability it does not name, and for a new capability's delta without `## Purpose`.

#### Scenario: A delta for an unnamed capability
- **WHEN** the proposal names only `task/cli` and the draft writes `specs/task/group/spec.md`
- **THEN** the gate SHALL report an `ERROR` naming `task/group`

#### Scenario: A new capability without a Purpose
- **WHEN** the delta for new capability `spec/export` has no `## Purpose`
- **THEN** the gate SHALL report an `ERROR` naming `spec/export`

### Requirement: The specs gate holds the change to the size budget
The gate SHALL include `sizeIssues` for the capabilities, requirements and scenarios counted from `openspec show <change> --json --deltas-only`, and SHALL NOT report the groups or tasks limits.

#### Scenario: Seventeen scenarios are sent back
- **WHEN** the deltas hold 17 scenarios
- **THEN** the gate SHALL report the scenarios `WARNING` naming `17` and `16`

### Requirement: The bundled specify script keeps the stage contract
`spec-specify.agent` SHALL lint with no error, keep the stage contract with `next_action` defaulting to `review`, and declare one subagent that sets `files`, `summary`, `next_action` and `question` from its outputs.

#### Scenario: The bundled specify script fits the contract
- **WHEN** the bundled `spec-specify.agent` is checked
- **THEN** it SHALL lint clean, pass the stage contract and declare exactly one subagent

## MODIFIED Requirements

### Requirement: The stages run in a fixed order
The task entry SHALL export `SPEC_STAGES` as `[proposalStage, designStage, specsStage]`, in that order; `spec` picks from it.

#### Scenario: The design follows the proposal
- **WHEN** the names in `SPEC_STAGES` are listed
- **THEN** they SHALL be `proposal`, `design`, `specs`
