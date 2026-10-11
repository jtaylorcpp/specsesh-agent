## RENAMED Requirements

- FROM: `### Requirement: The package exports exactly six entry points`
- TO: `### Requirement: The package exports exactly seven entry points`

- FROM: `### Requirement: Required dependencies are only the exact-pinned language packages`
- TO: `### Requirement: Required dependencies are only the exact-pinned language packages and TypeBox`

## MODIFIED Requirements

### Requirement: The package exports exactly seven entry points
The manifest's `exports` SHALL have exactly the keys `./authoring`, `./interpreter`, `./pi`, `./claude-code`, `./durable`, `./cloudflare` and `./openspec`. Each SHALL map to `{ "types": "./dist/<entry>/index.d.ts", "import": "./dist/<entry>/index.js" }`. There SHALL be no root `.` export and no `./package.json` export, so a deep import such as `@specsesh/agent/dist/interpreter/run.js` is refused by Node.

#### Scenario: The exports map is exact
- **WHEN** the manifest's `exports` is read
- **THEN** its keys SHALL be exactly the seven entries, in that order
- **AND** `exports["./durable"]` SHALL equal `{ "types": "./dist/durable/index.d.ts", "import": "./dist/durable/index.js" }`
- **AND** `exports["./openspec"]` SHALL equal `{ "types": "./dist/openspec/index.d.ts", "import": "./dist/openspec/index.js" }`

#### Scenario: A deep import is refused
- **GIVEN** the packed tarball installed in an empty project
- **WHEN** Node imports `@specsesh/agent/dist/interpreter/run.js`
- **THEN** it SHALL fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`

#### Scenario: The bare package name is not importable
- **GIVEN** the packed tarball installed in an empty project
- **WHEN** Node imports `@specsesh/agent`
- **THEN** it SHALL fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`

### Requirement: Required dependencies are only the exact-pinned language packages and TypeBox
The manifest's `dependencies` SHALL be exactly `@sf-agentscript/agentforce-dialect` `2.53.0`, `@sf-agentscript/agentscript-dialect` `3.4.0`, `@sf-agentscript/language` `3.2.3` and `@sf-agentscript/parser-javascript` `3.1.3` (see `core/authoring`), and `typebox` `1.3.27`, the schema library of `./openspec` and the version `@earendil-works/pi-ai` pins. No other package SHALL be a required dependency.

#### Scenario: Four dependencies, all exact
- **WHEN** the manifest's `dependencies` is read
- **THEN** its `@sf-agentscript/*` keys SHALL be exactly the four packages, at those versions

#### Scenario: TypeBox is the only other dependency
- **WHEN** the manifest's `dependencies` is read
- **THEN** its keys SHALL be exactly the four `@sf-agentscript/*` packages and `typebox`
- **AND** `typebox` SHALL be `1.3.27`, an exact version

### Requirement: The core entries work with no peer installed
With only `@specsesh/agent` and its required dependencies installed, importing `@specsesh/agent/authoring`, `@specsesh/agent/interpreter` and `@specsesh/agent/openspec` under plain Node SHALL succeed, and `run` with a caller-supplied port SHALL complete a script.

#### Scenario: A script runs with no peers
- **GIVEN** the packed tarball installed in an empty project with no peer installed (no `@earendil-works/*`, no `agents`)
- **WHEN** a Node script imports `run` from `@specsesh/agent/interpreter` and runs a one-step script with a stub port answering `{ kind: "answered", text: "hi" }`
- **THEN** it SHALL exit `0` with a result of `kind: "completed"`

#### Scenario: The openspec entry checks a value with no peers
- **GIVEN** the packed tarball installed in an empty project with no peer installed
- **WHEN** a Node script imports `@specsesh/agent/openspec` and checks `{ keyword: "BUT", text: "x" }` against the `Clause` schema
- **THEN** the check SHALL fail, and the script SHALL exit `0`

### Requirement: Each layer imports only its own peers and the layers beneath it
`src/pi/` SHALL import only `@earendil-works/pi-ai`, Node builtins, the core directories and itself. `src/claude-code/` adds `src/pi/`. `src/durable/` adds `@earendil-works/pi-durable`, `@earendil-works/chord` and `src/claude-code/`. Only `src/cloudflare/` SHALL import `agents` or `cloudflare:workers`, and it adds `src/durable/`. `src/openspec/` SHALL import only `typebox` and itself. `src/bin/` may import any layer.

#### Scenario: The layer graph holds
- **WHEN** every import under `src/pi/`, `src/claude-code/`, `src/durable/`, `src/cloudflare/` and `src/openspec/` is reduced to a package name or a top-level `src/` directory
- **THEN** each directory's set SHALL be within the set this requirement allows it
- **AND** the scan SHALL have read at least one file in each directory

#### Scenario: Nothing outside cloudflare touches Workers
- **WHEN** every file under `src/` except `src/cloudflare/` is scanned
- **THEN** none SHALL import `agents`, `agents/*` or `cloudflare:workers`

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the seven entry points with one line each on what they hold and which peers they need, and name both bins.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the seven `@specsesh/agent/<entry>` strings, `agentscript-pi` and `agentscript-durable`

### Requirement: The examples consume the package like any other project
`examples/hello-world` and `examples/cloudflare-worker` SHALL depend on `"@specsesh/agent": "workspace:*"`, import only through its seven entries, and depend on no other workspace package. The Cloudflare Worker SHALL bundle `@specsesh/agent/cloudflare` with wrangler.

#### Scenario: Examples import only public entries
- **WHEN** every import in `examples/*/` source is read
- **THEN** each `@specsesh/agent` import SHALL be one of the seven entries
- **AND** no import SHALL reach `packages/` by a relative path
