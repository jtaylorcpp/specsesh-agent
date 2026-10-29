## MODIFIED Requirements

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the eleven entry points with one line each on what they hold and which peers they need, name all four bins, and point at `npx specsesh`. `packages/specsesh/README.md` SHALL give `npx specsesh --help`, `npm install --save-dev specsesh`, the four commands `agent`, `durable`, `task` and `change`, and Node `22.19`.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the eleven `@specsesh/agent/<entry>` strings, `agentscript-pi`, `agentscript-durable`, `agentscript-task`, `agentscript-change` and `npx specsesh`

#### Scenario: The specsesh readme shows how to run it
- **WHEN** `packages/specsesh/README.md` is read
- **THEN** it SHALL contain `npx specsesh --help`, `npm install --save-dev specsesh`, `specsesh agent`, `specsesh durable`, `specsesh task`, `specsesh change` and `22.19`

### Requirement: The package exports one entry per layer and the command
The manifest's `exports` SHALL have exactly the keys `./authoring`, `./interpreter`, `./pi`, `./claude-code`, `./durable`, `./node`, `./mcp`, `./cloudflare`, `./openspec`, `./task` and `./cli`, in that order, each mapping to `{ "types": "./dist/<entry>/index.d.ts", "import": "./dist/<entry>/index.js" }`. There SHALL be no root `.` and no `./package.json` export, so a deep import is refused by Node.

#### Scenario: The exports map is exact
- **WHEN** the manifest's `exports` is read
- **THEN** its keys SHALL be exactly the eleven entries, in that order
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


## ADDED Requirements

### Requirement: The layers import only their own peers and the layers beneath them
`src/pi/` SHALL import only `@earendil-works/pi-ai`, Node builtins, the core directories and itself. `src/claude-code/` adds `src/pi/`. `src/durable/` adds `pi-durable`, `chord` and `src/openspec/`, but no Node builtin or `src/claude-code/`. `src/node/` adds `src/durable/` and `src/claude-code/`, `src/mcp/` those and the MCP SDK, `src/task/` `src/node/`. Only `src/cloudflare/` SHALL import `agents` or `cloudflare:workers`, adding `src/durable/`. `src/openspec/` imports only `typebox`.

#### Scenario: The layer graph holds
- **WHEN** every import under `src/pi/`, `src/claude-code/`, `src/durable/`, `src/node/`, `src/mcp/`, `src/task/`, `src/cloudflare/` and `src/openspec/` is reduced to a package name or a top-level `src/` directory
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

#### Scenario: Only the mcp layer speaks MCP
- **WHEN** every file under `src/` is scanned
- **THEN** only files under `src/mcp/` SHALL import `@modelcontextprotocol/sdk` or a subpath of it
- **AND** none SHALL import it with a dynamic `import()`

### Requirement: The node entry loads without the MCP SDK
Importing `@specsesh/agent/node` SHALL resolve no `@modelcontextprotocol/sdk` module, statically or dynamically: the SDK is reached only through `@specsesh/agent/mcp`, which imports it statically. The bins SHALL load `./mcp` only when a run needs it, so they start without the SDK installed.

#### Scenario: Importing ./node loads no MCP SDK module
- **GIVEN** a Node process with a resolve hook that records every resolved URL
- **WHEN** it imports the built `dist/node/index.js`
- **THEN** no recorded URL SHALL contain `@modelcontextprotocol`

#### Scenario: The mcp entry exports the MCP tools
- **WHEN** the built `dist/mcp/index.js` is imported
- **THEN** `mcpTools`, `mapTool`, `McpServerError` and `mcpBridge` SHALL be functions
- **AND** the built `dist/node/index.js` SHALL export none of them

## REMOVED Requirements

### Requirement: Each layer imports only its own peers and the layers beneath it
**Reason**: `src/mcp/` takes the MCP SDK from `src/node/`, and the scenario "Only the node layer speaks MCP" no longer holds.
**Migration**: Replaced by "The layers import only their own peers and the layers beneath them", whose scenario "Only the mcp layer speaks MCP" names `src/mcp/`.
