## REMOVED Requirements

### Requirement: The package exports exactly nine entry points
**Reason**: The `specsesh` command adds a tenth entry, `./cli`.
**Migration**: See "The package exports one entry per layer and the command", which keeps the nine entries, their targets and the refusals.

## ADDED Requirements

### Requirement: The package exports one entry per layer and the command
The manifest's `exports` SHALL have exactly the keys `./authoring`, `./interpreter`, `./pi`, `./claude-code`, `./durable`, `./node`, `./cloudflare`, `./openspec`, `./task` and `./cli`, in that order, each mapping to `{ "types": "./dist/<entry>/index.d.ts", "import": "./dist/<entry>/index.js" }`. There SHALL be no root `.` and no `./package.json` export, so a deep import is refused by Node.

#### Scenario: The exports map is exact
- **WHEN** the manifest's `exports` is read
- **THEN** its keys SHALL be exactly the ten entries, in that order
- **AND** `exports["./task"]` SHALL equal `{ "types": "./dist/task/index.d.ts", "import": "./dist/task/index.js" }`
- **AND** `exports["./cli"]` SHALL equal `{ "types": "./dist/cli/index.d.ts", "import": "./dist/cli/index.js" }`

#### Scenario: A deep import is refused
- **GIVEN** the packed tarball installed in an empty project
- **WHEN** Node imports `@specsesh/agent/dist/interpreter/run.js`
- **THEN** it SHALL fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`

#### Scenario: The bare package name is not importable
- **GIVEN** the packed tarball installed in an empty project
- **WHEN** Node imports `@specsesh/agent`
- **THEN** it SHALL fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`
