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
The task entry SHALL export `SPEC_STAGES` as `[proposalStage, designStage, specsStage, tasksStage]`, in that order; `spec` picks from it.

#### Scenario: The design follows the proposal
- **WHEN** the names in `SPEC_STAGES` are listed
- **THEN** they SHALL be `proposal`, `design`, `specs`, `tasks`

### Requirement: The bundled design script keeps the stage contract
`spec-design.agent` SHALL lint with no error, keep the stage contract with `next_action` defaulting to `review`, and declare one subagent that sets `files`, `summary`, `next_action` and `question` from its outputs.

#### Scenario: The bundled design script fits the contract
- **WHEN** the bundled `spec-design.agent` is checked
- **THEN** it SHALL lint clean, pass the stage contract and declare exactly one subagent

### Requirement: The specs stage derives deltas from the approved design
The task entry SHALL export `specsStage`, named `specs`, owning `specs/`, after `design`, with the bundled `spec-specify.agent`. Its seed SHALL set `approved` to `proposal.md`, `design.md` and every file under `design/` as `=== ` sections, and `base` to the full spec of each capability the proposal modifies.

#### Scenario: The specs stage sees the mock and examples
- **GIVEN** an approved design with `design/mock.html` and `design/examples/a.ts`
- **WHEN** the specs stage's seed runs
- **THEN** `approved` SHALL hold sections for `proposal.md`, `design.md`, `design/mock.html` and `design/examples/a.ts`

### Requirement: Strict validation is the specs gate's first rule
The gate SHALL run `openspec validate <change> --strict --json` in the workspace through `runOpenspec` with the bin from `resolveOpenspec(workspace)`, with `OPENSPEC_TELEMETRY=0`, reporting each issue at its own level and path. A command that cannot run or prints no parseable JSON SHALL be one `ERROR` naming the command and ending ` (<describeOpenspec(bin)>)`, or ` (openspec not found)` when no openspec was found.

#### Scenario: An OpenSpec error reaches the next draft
- **WHEN** `openspec validate` reports `Requirement must have at least one scenario` for `specs/plan/export/spec.md`
- **THEN** the gate SHALL report that message as an `ERROR` with that path

#### Scenario: openspec is missing
- **WHEN** neither the project's `node_modules/.bin` nor PATH has `openspec`
- **THEN** the gate SHALL report one `ERROR` `` `openspec validate add-plan-export --strict --json` could not run (openspec not found) ``

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

### Requirement: The tasks stage plans from the approved deltas
The task entry SHALL export `tasksStage`, named `tasks`, owning `tasks.md`, after `specs`, with the bundled `spec-plan.agent`. Its seed SHALL set `approved` to the proposal, `design.md`, the files under `design/examples/` and every delta as `=== ` sections, and `base` to the workspace's `git ls-files`, cut at 3,000 lines with a line saying how many were cut.

#### Scenario: The tasks stage is seeded with the repository's files
- **GIVEN** a git workspace tracking 3,005 files
- **WHEN** the tasks stage's seed runs
- **THEN** `base` SHALL hold 3,000 paths and a last line saying 5 were cut

### Requirement: tasks.md is a list of unticked single-action tasks
The tasks gate SHALL report an `ERROR` for a line under a group heading that is neither a task nor its continuation, a task list failing the ontology's `TaskList` check, and a ticked task; and `taskIssues` for each task, its claims being the scenario names it quotes.

#### Scenario: A ticked task is sent back
- **WHEN** a draft holds `- [x] 1.1 …`
- **THEN** the gate SHALL report an `ERROR` naming task `1.1`

#### Scenario: A task naming two files is sent back
- **WHEN** a task names `src/a.ts` and `src/b.ts`
- **THEN** the gate SHALL report the `taskIssues` `WARNING` naming both

### Requirement: Every scenario of the change is named by a task
Each scenario of an ADDED or MODIFIED delta whose exact name no task quotes in double quotes SHALL be an `ERROR` naming the scenario and its capability.

#### Scenario: An unclaimed scenario is sent back
- **GIVEN** deltas with the scenario `A clean draft waits for review`
- **WHEN** no task quotes `"A clean draft waits for review"`
- **THEN** the gate SHALL report an `ERROR` naming that scenario

### Requirement: The tasks gate holds the change to the task budget
The gate SHALL include `sizeIssues` for the groups and tasks counted from `tasks.md`, and SHALL NOT report the capabilities, requirements or scenarios limits.

#### Scenario: Thirteen tasks are sent back
- **WHEN** `tasks.md` holds 13 tasks
- **THEN** the gate SHALL report the tasks `WARNING` naming `13` and `12`

### Requirement: The bundled plan script keeps the stage contract
`spec-plan.agent` SHALL lint with no error, keep the stage contract with `next_action` defaulting to `review`, and declare one subagent that sets `files`, `summary`, `next_action` and `question` from its outputs.

#### Scenario: The bundled plan script fits the contract
- **WHEN** the bundled `spec-plan.agent` is checked
- **THEN** it SHALL lint clean, pass the stage contract and declare exactly one subagent

### Requirement: The specs gate runs the trial fold after clean validation
When strict change validation reports no `ERROR`, the gate SHALL add `trialFoldIssues` from `src/task/stages/trial-fold-issues.ts`: one issue per trial fold issue, at its level, with message `trial fold: <spec>: <message>` and path `specs/<spec>/spec.md` when the change has a delta for `<spec>`, else `openspec/specs/<spec>/spec.md`. When that validation reports an `ERROR`, the trial fold SHALL NOT run.

#### Scenario: A folded requirement over 500 characters is sent back
- **GIVEN** a change with a delta `specs/spec/judge/spec.md` that passes `openspec validate <change> --strict`
- **WHEN** the trial fold reports the `ERROR` `Requirement "The judge scores each draft" text exceeds 500 characters (612)` for `spec/judge`
- **THEN** the gate SHALL report that `ERROR` with path `specs/spec/judge/spec.md` and message `trial fold: spec/judge: Requirement "The judge scores each draft" text exceeds 500 characters (612)`, and the loop SHALL iterate

#### Scenario: A fold warning on a spec without a delta
- **GIVEN** a change with no delta for `core/subset`
- **WHEN** the trial fold reports the `WARNING` `Purpose section is too brief` for `core/subset`
- **THEN** the gate SHALL report a `WARNING` with path `openspec/specs/core/subset/spec.md` and message `trial fold: core/subset: Purpose section is too brief`

#### Scenario: An invalid change skips the trial fold
- **WHEN** `openspec validate <change> --strict --json` reports an `ERROR`
- **THEN** the gate SHALL NOT call `trialFold`, and no issue SHALL start with `trial fold:`

#### Scenario: A clean trial fold lets the draft wait for review
- **GIVEN** a draft whose change validation, coverage and size rules report nothing
- **WHEN** the trial fold reports no issues
- **THEN** the gate SHALL report no issues and the draft SHALL wait for review

### Requirement: A trial fold that cannot run is one ERROR
When `trialFold` returns a `failure`, `trialFoldIssues` SHALL return exactly one `ERROR`, with no path, whose message is `openspec validate --specs --strict could not run: ` followed by that `failure`, then ` (<describeOpenspec(bin)>)`, or ` (openspec not found)` when no openspec was found.

#### Scenario: The fold prints no parseable JSON
- **GIVEN** the resolved openspec `/repo/node_modules/.bin/openspec` at `1.14.1`
- **WHEN** `trialFold` returns `failure` `no parseable JSON on stdout`
- **THEN** the gate SHALL report one `ERROR` with message `openspec validate --specs --strict could not run: no parseable JSON on stdout (openspec 1.14.1 at /repo/node_modules/.bin/openspec)`

#### Scenario: openspec is missing at the fold
- **GIVEN** strict change validation reports no `ERROR`
- **WHEN** `openspec` cannot be spawned for the trial fold
- **THEN** the gate SHALL report one `ERROR` naming `openspec validate --specs --strict`, and the loop SHALL iterate

### Requirement: openspec is resolved from the project first
`resolveOpenspec(workspace)` in `openspec-bin.ts` SHALL try `<workspace>/node_modules/.bin/openspec` (and `.cmd` on `win32`), then each PATH entry, never parent directories, and return `{ path, version, source: "project" | "path" }` with `path` absolute. `version` SHALL be the first `x.y.z` printed by `<path> --version` run with `OPENSPEC_TELEMETRY=0`, else `null`. Results SHALL be memoised per workspace until `resetOpenspecCache()`.

#### Scenario: The project copy wins over PATH
- **GIVEN** a workspace `/repo` with `node_modules/.bin/openspec` printing `1.14.1`, and `/usr/local/bin/openspec` printing `1.9.0` first on PATH
- **WHEN** `resolveOpenspec("/repo")` runs
- **THEN** it SHALL return `{ path: "/repo/node_modules/.bin/openspec", version: "1.14.1", source: "project" }`

#### Scenario: PATH is used when the project has no copy, and resolved once
- **GIVEN** a workspace with no `node_modules/.bin/openspec`, and `/usr/local/bin/openspec` on PATH printing `1.9.0`
- **WHEN** `resolveOpenspec` runs twice for that workspace
- **THEN** both SHALL return `{ path: "/usr/local/bin/openspec", version: "1.9.0", source: "path" }`, and `--version` SHALL have run once

#### Scenario: The version is the first x.y.z
- **WHEN** the resolved openspec's `--version` prints `openspec/1.14.1-rc.1 linux`
- **THEN** `version` SHALL be `1.14.1`

### Requirement: Unreadable openspec output names the openspec that ran
The specs gate SHALL run `openspec show <change> --json --deltas-only` through `runOpenspec` with the resolved bin. Every gate issue for openspec that cannot run, prints no parseable JSON, or lacks what the gate needs SHALL end ` (<describeOpenspec(bin)>)`, which is `openspec <version> at <path>`, or ` (openspec not found)` when none was found. A gate SHALL NOT enforce the minimum version.

#### Scenario: show prints no parseable JSON
- **GIVEN** the resolved openspec `/repo/node_modules/.bin/openspec` at `1.14.1`
- **WHEN** `openspec show add-plan-export --json --deltas-only` prints no parseable JSON
- **THEN** the gate SHALL report the `ERROR` `` `openspec show add-plan-export --json --deltas-only` printed no parseable JSON (openspec 1.14.1 at /repo/node_modules/.bin/openspec) ``

#### Scenario: An old openspec is named, not refused, by the gate
- **GIVEN** a gate called through the library with the resolved openspec `/usr/local/bin/openspec` at `1.9.0`
- **WHEN** its `show --json` output has no requirement names
- **THEN** the gate SHALL run it and report an `ERROR` ending `(openspec 1.9.0 at /usr/local/bin/openspec)`, with no version refusal
