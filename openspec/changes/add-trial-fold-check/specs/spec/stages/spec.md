## ADDED Requirements

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
When `trialFold` returns a `failure`, `trialFoldIssues` SHALL return exactly one `ERROR`, with no path, whose message is `openspec validate --specs --strict could not run: ` followed by that `failure`.

#### Scenario: The fold prints no parseable JSON
- **WHEN** `trialFold` returns `failure` `no parseable JSON on stdout`
- **THEN** the gate SHALL report one `ERROR` with message `openspec validate --specs --strict could not run: no parseable JSON on stdout`

#### Scenario: openspec is missing at the fold
- **GIVEN** strict change validation reports no `ERROR`
- **WHEN** `openspec` cannot be spawned for the trial fold
- **THEN** the gate SHALL report one `ERROR` naming `openspec validate --specs --strict`, and the loop SHALL iterate

