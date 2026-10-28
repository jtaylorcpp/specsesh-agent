## MODIFIED Requirements

### Requirement: specsesh carries the command and its Node dependencies
The `specsesh` manifest SHALL have `bin` exactly `{ "specsesh": "./bin/specsesh.js" }`, `files` `["bin", "README.md", "LICENSE"]`, `exports` exactly `{ "./package.json": "./package.json" }`, and `dependencies` exactly `@specsesh/agent` at `workspace:*` plus `@earendil-works/pi-ai`, `@earendil-works/pi-durable`, `@earendil-works/chord` and `@modelcontextprotocol/sdk`, each at the exact version in `@specsesh/agent`'s `devDependencies`. It SHALL have no `peerDependencies`.

#### Scenario: The specsesh manifest is exact
- **WHEN** `packages/specsesh/package.json` is read
- **THEN** `bin`, `files`, `exports` and the keys of `dependencies` SHALL be exactly as required, with no `peerDependencies`
- **AND** each dependency other than `@specsesh/agent` SHALL equal the same key in `packages/agent/package.json`'s `devDependencies`

### Requirement: The layer libraries are optional peers
`peerDependencies` SHALL be `@earendil-works/pi-ai`, `@earendil-works/pi-durable` and `@earendil-works/chord` at `^1.1.0`, `agents` at `^0.28.0` and `@modelcontextprotocol/sdk` at `^1.32.1`, each marked `optional: true` in `peerDependenciesMeta`. The same packages SHALL be `devDependencies` at the versions the tests run on, so the workspace installs them.

#### Scenario: Every peer is optional
- **WHEN** the manifest's `peerDependencies` and `peerDependenciesMeta` are read
- **THEN** there SHALL be exactly the five peers at those ranges
- **AND** each SHALL have `peerDependenciesMeta[<name>].optional === true`

### Requirement: Each layer imports only its own peers and the layers beneath it
`src/pi/` SHALL import only `@earendil-works/pi-ai`, Node builtins, the core directories and itself. `src/claude-code/` adds `src/pi/`. `src/durable/` adds `pi-durable`, `chord` and `src/openspec/`, but no Node builtin or `src/claude-code/`. `src/node/` adds `src/durable/`, `src/claude-code/` and `@modelcontextprotocol/sdk`; `src/task/` adds `src/node/`. Only `src/cloudflare/` SHALL import `agents` or `cloudflare:workers`, adding `src/durable/`. `src/openspec/` imports only `typebox`.

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

#### Scenario: Only the node layer speaks MCP
- **WHEN** every file under `src/` is scanned
- **THEN** only files under `src/node/` SHALL import `@modelcontextprotocol/sdk` or a subpath of it
