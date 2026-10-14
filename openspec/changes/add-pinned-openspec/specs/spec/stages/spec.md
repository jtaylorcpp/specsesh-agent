## ADDED Requirements

### Requirement: openspec is found in the project first, then on PATH
`openspec-bin.ts` SHALL export `resolveOpenspec(workspace)`, returning `{ path, version, source }`: `<workspace>/node_modules/.bin/openspec` as `project` if present, else the first `openspec` on PATH as `path`, with no walk up parent directories, also trying `.cmd` on `win32`. `path` SHALL be absolute. `version` SHALL be the first `x.y.z` that `<path> --version` prints under `OPENSPEC_TELEMETRY=0`, else `null`.

#### Scenario: The project copy wins over PATH
- **GIVEN** a workspace `/repo` with `node_modules/.bin/openspec` printing `1.14.1`, and `/usr/local/bin/openspec` printing `1.9.0` first on PATH
- **WHEN** `resolveOpenspec("/repo")` runs with `node_modules/.bin` not on PATH
- **THEN** it SHALL return `{ path: "/repo/node_modules/.bin/openspec", version: "1.14.1", source: "project" }`

#### Scenario: Without a project copy PATH is used
- **GIVEN** a workspace with no `node_modules/.bin/openspec`, and `/usr/local/bin/openspec` printing `1.9.0` on PATH
- **WHEN** `resolveOpenspec` runs
- **THEN** it SHALL return `{ path: "/usr/local/bin/openspec", version: "1.9.0", source: "path" }`

#### Scenario: A version without x.y.z is null
- **GIVEN** the resolved openspec is `/opt/tools/openspec`, whose `--version` prints no `x.y.z`
- **WHEN** `resolveOpenspec` runs
- **THEN** it SHALL return `version: null` with `path: "/opt/tools/openspec"`

### Requirement: The resolved openspec is memoised per process
`resolveOpenspec` results SHALL be memoised per workspace for the life of the process, so `--version` runs once per workspace. `openspec-bin.ts` SHALL export `resetOpenspecCache()`, for tests, which clears them.

#### Scenario: --version runs once per process
- **WHEN** `resolveOpenspec` is called twice for the same workspace
- **THEN** `--version` SHALL have run once and both calls SHALL return the same result
- **AND** after `resetOpenspecCache()`, the next call SHALL run `--version` again

### Requirement: The openspec version is checked against 1.14.1
`OPENSPEC_MIN_VERSION` SHALL be `1.14.1`. `checkOpenspec(workspace)` SHALL resolve and compare `major.minor.patch` numerically, ignoring pre-release or build suffixes, and return `{ ok: true, bin }` at or above the minimum or when no openspec is found, else `{ ok: false, message }` with `<describeOpenspec(bin)> is below the minimum supported version 1.14.1`. `describeOpenspec(bin)` SHALL give `openspec <version> at <path>`, or `openspec (version unknown) at <path>` for a `null` version.

#### Scenario: 1.14.0 is below the minimum
- **GIVEN** the resolved openspec is `1.14.0` at `/usr/local/bin/openspec`
- **WHEN** `checkOpenspec` runs
- **THEN** it SHALL return `ok: false` with `openspec 1.14.0 at /usr/local/bin/openspec is below the minimum supported version 1.14.1`

#### Scenario: A suffix is ignored
- **WHEN** the resolved openspec's `--version` prints `1.14.1-rc.1`
- **THEN** `checkOpenspec` SHALL return `ok: true`

#### Scenario: A missing openspec is not refused
- **GIVEN** no openspec in the project or on PATH
- **WHEN** `checkOpenspec` runs
- **THEN** it SHALL return `ok: true`

## MODIFIED Requirements

### Requirement: Strict validation is the specs gate's first rule
The gate SHALL run `openspec validate <change> --strict --json` through `runOpenspec` in the workspace, under `OPENSPEC_TELEMETRY=0`, reporting each issue at its own level and path. A command that cannot run or prints no parseable JSON SHALL be one `ERROR` naming the command. Each `ERROR` about openspec output it cannot run, read or use SHALL end with `(<describeOpenspec(bin)>)` or `(openspec not found)`. The gate SHALL NOT enforce the minimum version.

#### Scenario: An OpenSpec error reaches the next draft
- **GIVEN** the workspace's resolved openspec is `1.9.0` at `/usr/local/bin/openspec`
- **WHEN** `openspec validate` reports `Requirement must have at least one scenario` for `specs/plan/export/spec.md`
- **THEN** the gate SHALL report that message as an `ERROR` with that path
- **AND** the command SHALL have run `/usr/local/bin/openspec` through `runOpenspec` with `OPENSPEC_TELEMETRY=0`, and the gate SHALL report no minimum-version issue

#### Scenario: openspec is missing
- **WHEN** no openspec is found in the project or on PATH
- **THEN** the gate SHALL report one `ERROR`: `` `openspec validate add-plan-export --strict --json` could not run (openspec not found) ``

#### Scenario: Unreadable show output names the openspec run
- **GIVEN** the resolved openspec is `1.14.1` at `/repo/node_modules/.bin/openspec`
- **WHEN** `openspec show add-plan-export --json --deltas-only` prints no parseable JSON
- **THEN** the gate SHALL report the `ERROR` `` `openspec show add-plan-export --json --deltas-only` printed no parseable JSON (openspec 1.14.1 at /repo/node_modules/.bin/openspec) ``
- **AND** when that command's JSON instead lacks the requirement names the gate needs, its `ERROR` SHALL end with the same `(openspec 1.14.1 at /repo/node_modules/.bin/openspec)`