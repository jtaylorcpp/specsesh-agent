## RENAMED Requirements

- FROM: `### Requirement: The package exports exactly eight entry points`
- TO: `### Requirement: The package exports exactly nine entry points`

## MODIFIED Requirements

### Requirement: The package exports exactly nine entry points
The manifest's `exports` SHALL have exactly the keys `./authoring`, `./interpreter`, `./pi`, `./claude-code`, `./durable`, `./node`, `./cloudflare`, `./openspec` and `./task`. Each SHALL map to `{ "types": "./dist/<entry>/index.d.ts", "import": "./dist/<entry>/index.js" }`. There SHALL be no root `.` export and no `./package.json` export, so a deep import such as `@specsesh/agent/dist/interpreter/run.js` is refused by Node.

#### Scenario: The exports map is exact
- **WHEN** the manifest's `exports` is read
- **THEN** its keys SHALL be exactly the nine entries, in that order
- **AND** `exports["./durable"]` SHALL equal `{ "types": "./dist/durable/index.d.ts", "import": "./dist/durable/index.js" }`
- **AND** `exports["./node"]` SHALL equal `{ "types": "./dist/node/index.d.ts", "import": "./dist/node/index.js" }`
- **AND** `exports["./openspec"]` SHALL equal `{ "types": "./dist/openspec/index.d.ts", "import": "./dist/openspec/index.js" }`
- **AND** `exports["./task"]` SHALL equal `{ "types": "./dist/task/index.d.ts", "import": "./dist/task/index.js" }`

#### Scenario: A deep import is refused
- **GIVEN** the packed tarball installed in an empty project
- **WHEN** Node imports `@specsesh/agent/dist/interpreter/run.js`
- **THEN** it SHALL fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`

#### Scenario: The bare package name is not importable
- **GIVEN** the packed tarball installed in an empty project
- **WHEN** Node imports `@specsesh/agent`
- **THEN** it SHALL fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`

### Requirement: Each layer imports only its own peers and the layers beneath it
`src/pi/` SHALL import only `@earendil-works/pi-ai`, Node builtins, the core directories and itself. `src/claude-code/` adds `src/pi/`. `src/durable/` adds `pi-durable`, `chord` and `src/openspec/`, but no Node builtin or `src/claude-code/`. `src/node/` adds `src/durable/` and `src/claude-code/`; `src/task/` adds `src/node/`. Only `src/cloudflare/` SHALL import `agents` or `cloudflare:workers`, adding `src/durable/`. `src/openspec/` imports only `typebox`.

#### Scenario: The layer graph holds
- **WHEN** every import under `src/pi/`, `src/claude-code/`, `src/durable/`, `src/node/`, `src/task/`, `src/cloudflare/` and `src/openspec/` is reduced to a package name or a top-level `src/` directory
- **THEN** each directory's set SHALL be within the set this requirement allows it
- **AND** the scan SHALL have read at least one file in each directory

#### Scenario: Nothing outside cloudflare touches Workers
- **WHEN** every file under `src/` except `src/cloudflare/` is scanned
- **THEN** none SHALL import `agents`, `agents/*` or `cloudflare:workers`

#### Scenario: The durable layer records with the ontology
- **WHEN** the imports under `src/durable/` are reduced
- **THEN** they SHALL include `src/openspec`, the ontology its host actions build their Action and Evidence records with
- **AND** they SHALL NOT include `typebox`, which only `src/openspec/` imports

#### Scenario: The durable layer is free of Node
- **WHEN** the imports under `src/durable/` are reduced
- **THEN** none SHALL start with `node:`, and none SHALL be `src/claude-code` or `src/node`
- **AND** neither SHALL any import of `src/cloudflare/`, followed transitively into `src/`

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the nine entry points with one line each on what they hold and which peers they need, and name all three bins.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the nine `@specsesh/agent/<entry>` strings, `agentscript-pi`, `agentscript-durable` and `agentscript-task`
