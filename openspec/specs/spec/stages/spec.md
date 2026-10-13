# spec/stages Specification

## Purpose
The stages of the spec loop (proposal, design, specs and tasks): for each, the files it owns, the stages it follows, what it is seeded with, and the rules its gate checks.

## Requirements

### Requirement: The proposal stage drafts proposal.md from the intent
The task entry SHALL export `proposalStage`, named `proposal`, owning `proposal.md` and `slices.md`, following no stage, with the bundled `spec-proposal.agent` as its script. Its seed SHALL set `base` to one line per capability in `openspec/specs/`: `<area>/<name>: <purpose>`, in path order.

#### Scenario: The proposal stage is seeded with every capability
- **GIVEN** a workspace whose `openspec/specs/` holds `core/subset` and `task/cli`
- **WHEN** the proposal stage's seed runs
- **THEN** `base` SHALL be two lines, `core/subset: …` then `task/cli: …`, each with that spec's purpose

### Requirement: A proposal has five sections in order
The proposal gate SHALL report an `ERROR` for each of `## Why`, `## What Changes`, `## Out of scope`, `## Capabilities` and `## Impact` that is missing, and one for sections present out of that order.

#### Scenario: A missing Out of scope section
- **WHEN** a draft without `## Out of scope` is gated
- **THEN** there SHALL be one `ERROR` naming `## Out of scope`

### Requirement: The Capabilities section names real paths
The gate SHALL read backticked `<area>/<name>` paths after `**New:**` and `**Modified:**`, on the label's line and its nested bullets. It SHALL report an `ERROR` when none is named, when a modified path has no spec in `openspec/specs/`, and when a new path already has one.

#### Scenario: Capabilities in nested bullets
- **WHEN** `**Modified:**` is followed by the nested bullets `` `task/cli` `` and `` `task/headless` ``
- **THEN** both SHALL be read as modified paths

#### Scenario: A modified path that does not exist
- **WHEN** a draft modifies `task/clii`
- **THEN** there SHALL be an `ERROR` naming `task/clii`

#### Scenario: A new path that already exists
- **WHEN** a draft lists `core/subset` as new
- **THEN** there SHALL be an `ERROR` saying `core/subset` already exists and belongs under Modified

### Requirement: A proposal over the capability budget is sent back
The gate SHALL include `proposalSizeIssues` for the capabilities read. Without a `slices.md`, each such `WARNING` SHALL also say to write `slices.md` with one line per small change, this one first. With one, the proposal SHALL be within budget.

#### Scenario: A proposal touching three capabilities is sent back
- **WHEN** a draft names one new and two modified capabilities and there is no `slices.md`
- **THEN** the gate SHALL report the size `WARNING` listing all three and saying to write `slices.md`, and the loop SHALL iterate

### Requirement: The bundled proposal script keeps the stage contract
`spec-proposal.agent` SHALL lint with no error, keep the stage contract with `next_action` defaulting to `review`, and declare one subagent that sets `files`, `summary`, `next_action` and `question` from its outputs.

#### Scenario: The bundled proposal script fits the contract
- **WHEN** the bundled `spec-proposal.agent` is checked
- **THEN** it SHALL lint clean, pass the stage contract and declare exactly one subagent

### Requirement: An oversized intent is sliced into ordered changes
`slices.md` SHALL hold lines `` <n>. `<change-id>`: <intent> ``, numbered from 1. The gate SHALL report an `ERROR` for a line that does not match (naming its number), fewer than two entries, a first id other than the change's own, an id that is not kebab-case, and an id already used by a change or an archived change.

#### Scenario: A sliced proposal passes
- **GIVEN** `slices.md` for `add-plan-export` with three new ids, `add-plan-export` first, and a `proposal.md` naming one capability
- **WHEN** the gate runs
- **THEN** it SHALL report no `ERROR` or `WARNING`

#### Scenario: A slice whose id is taken
- **WHEN** `slices.md`'s second entry is `add-spec-loop`, an existing change
- **THEN** the gate SHALL report an `ERROR` naming `add-spec-loop`

#### Scenario: The first slice must be this change
- **WHEN** `slices.md` for `add-plan-export` starts with `add-plan-schema`
- **THEN** the gate SHALL report an `ERROR` naming `add-plan-export`
