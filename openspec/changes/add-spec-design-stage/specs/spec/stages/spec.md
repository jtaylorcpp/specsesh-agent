## ADDED Requirements

### Requirement: The design stage drafts the design from the approved proposal
The task entry SHALL export `designStage`, named `design`, owning `design.md` and `design/`, after `proposal`, with the bundled `spec-design.agent`. Its seed SHALL set `approved` to `proposal.md` as a `=== ` bundle, and `base` to a `=== openspec/specs/<area>/<name>/spec.md` section per capability the proposal modifies.

#### Scenario: The design stage is seeded with the modified specs
- **GIVEN** an approved proposal modifying `task/cli` and adding `spec/stages`
- **WHEN** the design stage's seed runs
- **THEN** `base` SHALL hold one section, `openspec/specs/task/cli/spec.md`, with that file's text

### Requirement: A design has sections, a mock and an example
The design gate SHALL report an `ERROR` when `design.md` has fewer than two `## ` sections, when no `.html` file is under `design/`, and when no file is under `design/examples/`.

#### Scenario: A design without a mock
- **WHEN** a draft writes `design.md` and `design/examples/a.ts` but no `.html` file
- **THEN** the gate SHALL report an `ERROR` saying a mock is needed

#### Scenario: A design without an example
- **WHEN** a draft writes `design.md` and `design/mock.html` but nothing under `design/examples/`
- **THEN** the gate SHALL report an `ERROR` saying an example is needed

### Requirement: The mock is one self-contained HTML document
Each `.html` file under `design/` SHALL begin, after whitespace, with `<!doctype html>` in any case and contain `</html>`; and no `src` or `href` value in it MAY start with `http:`, `https:` or `//`. Each breach SHALL be an `ERROR` naming the file.

#### Scenario: A mock that loads a script from the network
- **WHEN** `design/mock.html` contains `<script src="https://cdn.example.com/x.js">`
- **THEN** the gate SHALL report an `ERROR` naming `design/mock.html`

#### Scenario: A fragment is not a mock
- **WHEN** `design/mock.html` is `<div>hi</div>`
- **THEN** the gate SHALL report an `ERROR` naming `design/mock.html`

### Requirement: Every design path design.md names exists
Every `design/…` path in `design.md`, in backticks or as a link target, SHALL be a file the stage owns as now on disk; each that is not SHALL be an `ERROR` naming it.

#### Scenario: design.md names a missing example
- **WHEN** `design.md` links `design/examples/missing.ts` and no such file exists
- **THEN** the gate SHALL report an `ERROR` naming `design/examples/missing.ts`

### Requirement: The stages run in a fixed order
The task entry SHALL export `SPEC_STAGES` as `[proposalStage, designStage]`, in that order; `spec` picks from it.

#### Scenario: The design follows the proposal
- **WHEN** the names in `SPEC_STAGES` are listed
- **THEN** they SHALL be `proposal`, `design`

### Requirement: The bundled design script keeps the stage contract
`spec-design.agent` SHALL lint with no error, keep the stage contract with `next_action` defaulting to `review`, and declare one subagent that sets `files`, `summary`, `next_action` and `question` from its outputs.

#### Scenario: The bundled design script fits the contract
- **WHEN** the bundled `spec-design.agent` is checked
- **THEN** it SHALL lint clean, pass the stage contract and declare exactly one subagent
