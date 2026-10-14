## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Strict validation is the specs gate's first rule
The gate SHALL run `openspec validate <change> --strict --json` in the workspace through `runOpenspec` with the bin from `resolveOpenspec(workspace)`, with `OPENSPEC_TELEMETRY=0`, reporting each issue at its own level and path. A command that cannot run or prints no parseable JSON SHALL be one `ERROR` naming the command and ending ` (<describeOpenspec(bin)>)`, or ` (openspec not found)` when no openspec was found.

#### Scenario: An OpenSpec error reaches the next draft
- **WHEN** `openspec validate` reports `Requirement must have at least one scenario` for `specs/plan/export/spec.md`
- **THEN** the gate SHALL report that message as an `ERROR` with that path

#### Scenario: openspec is missing
- **WHEN** neither the project's `node_modules/.bin` nor PATH has `openspec`
- **THEN** the gate SHALL report one `ERROR` `` `openspec validate add-plan-export --strict --json` could not run (openspec not found) ``

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
