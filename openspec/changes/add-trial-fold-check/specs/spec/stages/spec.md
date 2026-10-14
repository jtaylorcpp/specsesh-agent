## ADDED Requirements

### Requirement: The specs gate runs the trial fold when change validation is clean
When strict change validation reports no `ERROR`, the gate SHALL add `trialFoldIssues` from `src/task/stages/trial-fold-issues.ts`, which calls the shared `trialFold` of `src/task/cmd-close.ts`. Each fold `ERROR` or `WARNING` SHALL be an issue at its level, with message `trial fold: <spec>: <message>` and path `specs/<spec>/spec.md` when the change has a delta for that spec, else `openspec/specs/<spec>/spec.md`. `INFO` SHALL be dropped.

#### Scenario: A folded MODIFIED requirement over 500 characters is sent back
- **GIVEN** a change with a delta for `spec/judge` whose strict change validation reports no issue
- **WHEN** the trial fold reports the `ERROR` `Requirement "The judge scores each draft" text exceeds 500 characters (612)` for `spec/judge`
- **THEN** the gate SHALL report an `ERROR` with path `specs/spec/judge/spec.md` and message `trial fold: spec/judge: Requirement "The judge scores each draft" text exceeds 500 characters (612)`
- **AND** the spec loop SHALL iterate

#### Scenario: A fold warning on a spec without a delta keeps the workspace path
- **GIVEN** a change with no delta for `core/subset`
- **WHEN** the trial fold reports the `WARNING` `Purpose section is too brief` for `core/subset`
- **THEN** the gate SHALL report a `WARNING` with path `openspec/specs/core/subset/spec.md` and message `trial fold: core/subset: Purpose section is too brief`

#### Scenario: The fold is skipped when change validation fails
- **WHEN** `openspec validate <change> --strict --json` reports an `ERROR`
- **THEN** the gate SHALL NOT call `trialFold`, and no issue SHALL have a message starting `trial fold:`

#### Scenario: A fold reporting only INFO adds no issue
- **GIVEN** strict change validation reports no issue
- **WHEN** the trial fold's JSON report holds only an `INFO` issue
- **THEN** the gate SHALL report no issue whose message starts `trial fold:`

### Requirement: A trial fold that cannot run is one ERROR
When `trialFold` returns a `failure`, `trialFoldIssues` SHALL return exactly one `ERROR`, with no path, whose message is `openspec validate --specs --strict could not run: ` followed by the failure text.

#### Scenario: The fold prints no parseable JSON
- **GIVEN** strict change validation reports no issue
- **WHEN** the trial fold's command prints no parseable JSON
- **THEN** the gate SHALL report exactly one fold issue, an `ERROR` whose message starts `openspec validate --specs --strict could not run:`

#### Scenario: openspec is missing during the fold
- **GIVEN** strict change validation reports no issue
- **WHEN** `openspec` cannot be spawned for the trial fold
- **THEN** the gate SHALL report one `ERROR` naming `openspec validate --specs --strict`

