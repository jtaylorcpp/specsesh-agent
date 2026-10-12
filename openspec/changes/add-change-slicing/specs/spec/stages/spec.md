## MODIFIED Requirements

### Requirement: The proposal stage drafts proposal.md from the intent
The task entry SHALL export `proposalStage`, named `proposal`, owning `proposal.md` and `slices.md`, following no stage, with the bundled `spec-proposal.agent` as its script. Its seed SHALL set `base` to one line per capability in `openspec/specs/`: `<area>/<name>: <purpose>`, in path order.

#### Scenario: The proposal stage is seeded with every capability
- **GIVEN** a workspace whose `openspec/specs/` holds `core/subset` and `task/cli`
- **WHEN** the proposal stage's seed runs
- **THEN** `base` SHALL be two lines, `core/subset: …` then `task/cli: …`, each with that spec's purpose

### Requirement: A proposal over the capability budget is sent back
The gate SHALL include `proposalSizeIssues` for the capabilities read. Without a `slices.md`, each such `WARNING` SHALL also say to write `slices.md` with one line per small change, this one first. With one, the proposal SHALL be within budget.

#### Scenario: A proposal touching three capabilities is sent back
- **WHEN** a draft names one new and two modified capabilities and there is no `slices.md`
- **THEN** the gate SHALL report the size `WARNING` listing all three and saying to write `slices.md`, and the loop SHALL iterate

## ADDED Requirements

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
