## ADDED Requirements

### Requirement: The trial fold is the specs gate's second rule
When strict validation reports no `ERROR`, the gate SHALL run the trial fold through `trialFoldIssues` and report, after strict validation's issues and before coverage and size, one issue per fold `ERROR` or `WARNING`: at the fold's level, its message `trial fold: <area>/<name>: <message>`, its path `specs/<area>/<name>/spec.md` when the change has that delta, else `openspec/specs/<area>/<name>/spec.md`. Issues on specs the change does not touch SHALL NOT be dropped.

#### Scenario: A MODIFIED requirement too long after folding
- **GIVEN** a change whose delta `specs/spec/judge/spec.md` passes strict validation, and whose folded `spec/judge` has the requirement `The judge scores each draft` over 500 characters
- **WHEN** the specs gate runs
- **THEN** it SHALL report an `ERROR` with path `specs/spec/judge/spec.md` and a message starting `trial fold: spec/judge: `, and the spec loop SHALL iterate

#### Scenario: A fold issue on a spec the change does not touch
- **GIVEN** a change with no delta for `core/subset`
- **WHEN** the trial fold reports a `WARNING` for `core/subset`
- **THEN** the gate SHALL report a `WARNING` with path `openspec/specs/core/subset/spec.md` and a message starting `trial fold: core/subset: `

#### Scenario: An invalid delta is not folded
- **WHEN** strict validation reports an `ERROR`
- **THEN** the trial fold SHALL NOT run, and no issue's message SHALL start with `trial fold: `

#### Scenario: A clean fold adds no issue
- **WHEN** strict validation reports no issue and the trial fold reports no `ERROR` or `WARNING`
- **THEN** no issue's message SHALL start with `trial fold: `

### Requirement: One module wraps the shared trial fold
`src/spec/trial-fold-issues.ts` SHALL export `trialFoldIssues(workspace, change, deltaSpecs)`, calling the trial fold `cmd-close.ts` exports, with any adapter for its shape kept there. The specs gate and the change loop's `check` SHALL reach the fold only through this module. A fold that throws (openspec not spawned, no parseable output, a failed copy) SHALL be one `ERROR` whose path is `trial fold (openspec validate --specs --strict)` and whose message starts with it.

#### Scenario: The fold cannot run
- **GIVEN** strict validation reports no issue
- **WHEN** the trial fold throws because the temporary copy of `openspec/` fails
- **THEN** the gate SHALL report exactly one trial fold issue, an `ERROR` naming `trial fold (openspec validate --specs --strict)`

#### Scenario: One fold serves both callers
- **GIVEN** the trial fold exported by `cmd-close.ts` replaced by a stub
- **WHEN** the specs gate runs on a strictly valid change, and a change loop's change checks all exit `0`
- **THEN** the stub SHALL be called once by each, and no other module SHALL run `openspec validate --specs --strict`

