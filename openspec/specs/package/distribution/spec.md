# package/distribution Specification

## Purpose
How the library is published: one npm package, `@specsesh/agent`, with an entry point per layer, built JavaScript and type declarations, optional peers for the layers that need them, and a check that the packed tarball installs and runs.

## Requirements

### Requirement: The build emits JavaScript and declarations file for file
`pnpm build` in `packages/agent` SHALL run `tsc -p tsconfig.build.json`, compiling `src/**/*.ts` (and no test file) into `dist/` with the same relative paths, each as `.js`, `.d.ts` and a source map, and SHALL copy every `src/task/scripts/*.agent` to `dist/task/scripts/`. Those scripts are the only files in `dist/` not compiled from `src/`. The build MUST fail on any type error. `dist/` SHALL NOT be committed.

#### Scenario: Every source file has its outputs
- **WHEN** `pnpm build` completes
- **THEN** for every `src/<path>.ts` there SHALL be `dist/<path>.js`, `dist/<path>.d.ts` and `dist/<path>.js.map`
- **AND** no `dist/` file SHALL come from `__tests__/`
- **AND** `dist/task/scripts/` SHALL hold exactly the `.agent` files of `src/task/scripts/`, byte for byte

#### Scenario: dist is ignored
- **WHEN** `git check-ignore packages/agent/dist` runs
- **THEN** it SHALL exit `0`

### Requirement: The tarball holds only the build, the readme and the license
The manifest's `files` SHALL be `["dist", "README.md", "LICENSE"]`. The tarball `npm pack` produces SHALL contain `package.json`, `README.md`, `LICENSE` and files under `dist/`, and nothing under `src/`, `__tests__/` or `scripts/`, and no `.ts` file other than `.d.ts`.

#### Scenario: The packed file list is clean
- **WHEN** `npm pack --dry-run --json` runs in `packages/agent`
- **THEN** every listed path SHALL be `package.json`, `README.md`, `LICENSE` or start with `dist/`
- **AND** no path SHALL end in `.ts` unless it ends in `.d.ts`

### Requirement: The four CLIs are compiled bins
The manifest's `bin` SHALL map `agentscript-pi` to `./dist/bin/agentscript-pi.js`, `agentscript-durable` to `./dist/bin/agentscript-durable.js`, `agentscript-task` to `./dist/bin/agentscript-task.js` and `agentscript-change` to `./dist/bin/agentscript-change.js`. Each SHALL start with `#!/usr/bin/env node`. `tsx` SHALL NOT be a dependency or peer dependency, and no published file SHALL reference it.

#### Scenario: The bins are wired to compiled files
- **WHEN** the manifest's `bin` is read after a build
- **THEN** all four targets SHALL exist and start with `#!/usr/bin/env node`

#### Scenario: tsx is gone
- **WHEN** the manifest and every file under `dist/` are scanned
- **THEN** none SHALL mention `tsx`

### Requirement: The layer libraries are optional peers
`peerDependencies` SHALL be `@earendil-works/pi-ai`, `@earendil-works/pi-durable` and `@earendil-works/chord` at `^1.1.0`, `agents` at `^0.28.0` and `@modelcontextprotocol/sdk` at `^1.32.1`, each marked `optional: true` in `peerDependenciesMeta`. The same packages SHALL be `devDependencies` at the versions the tests run on, so the workspace installs them.

#### Scenario: Every peer is optional
- **WHEN** the manifest's `peerDependencies` and `peerDependenciesMeta` are read
- **THEN** there SHALL be exactly the five peers at those ranges
- **AND** each SHALL have `peerDependenciesMeta[<name>].optional === true`

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

### Requirement: No published text names the old package
No file under `packages/agent/src/` or `packages/agent/dist/`, and neither `README.md` nor `package.json`, SHALL contain `@coopcli`.

#### Scenario: The old name is gone
- **WHEN** those files are scanned after a build
- **THEN** the set scanned SHALL be non-empty
- **AND** no file SHALL contain `@coopcli`

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the eleven entry points with one line each on what they hold and which peers they need, name all four bins, and point at `npx specsesh`. `packages/specsesh/README.md` SHALL give `npx specsesh --help`, `npm install --save-dev specsesh`, the four commands `agent`, `durable`, `task` and `change`, and Node `22.19`.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the eleven `@specsesh/agent/<entry>` strings, `agentscript-pi`, `agentscript-durable`, `agentscript-task`, `agentscript-change` and `npx specsesh`

#### Scenario: The specsesh readme shows how to run it
- **WHEN** `packages/specsesh/README.md` is read
- **THEN** it SHALL contain `npx specsesh --help`, `npm install --save-dev specsesh`, `specsesh agent`, `specsesh durable`, `specsesh task`, `specsesh change` and `22.19`

### Requirement: pack:check proves the tarball installs and runs
`pnpm pack:check` SHALL run `__tests__/package/pack.test.ts` under vitest, not in `pnpm test`. It SHALL `npm pack` `@specsesh/agent` and `pnpm pack` `specsesh`, install them into temp projects, import every agent entry but `./cloudflare` with the Node peers, run the installed `agentscript-durable run` on a faux model and `agentscript-task` and `specsesh`, name what failed, and clean up.

#### Scenario: A clean tarball passes
- **WHEN** `pnpm pack:check` runs on a clean checkout
- **THEN** every test in the file SHALL pass and `pnpm pack:check` SHALL exit `0`

#### Scenario: A broken entry fails by name
- **GIVEN** an `exports` target that does not exist in the tarball
- **WHEN** the pack check installs it and imports each entry
- **THEN** importing SHALL fail with an error naming that entry

#### Scenario: The installed task bin prints its usage
- **GIVEN** the packed tarball installed with the Node peers
- **WHEN** the installed `agentscript-task` runs with no arguments
- **THEN** it SHALL exit `2` with stderr beginning `usage:`, and the installed `./task` entry SHALL resolve its bundled `task.agent`

#### Scenario: The installed specsesh prints its version
- **GIVEN** an empty project with only the two tarballs installed, no peer added by hand
- **WHEN** the installed `specsesh --version` and `specsesh task` run
- **THEN** the first SHALL print `specsesh <version>` and exit `0`, and the second SHALL exit `2` with stderr beginning `usage:`

#### Scenario: The packed specsesh pins the agent exactly
- **WHEN** the `package.json` inside the `specsesh` tarball is read
- **THEN** `dependencies["@specsesh/agent"]` SHALL equal the `version` of both manifests, with no `workspace:` prefix

### Requirement: The examples consume the package like any other project
`examples/hello-world` and `examples/cloudflare-worker` SHALL depend on `"@specsesh/agent": "workspace:*"`, import only through its eight entries, and depend on no other workspace package. The Cloudflare Worker SHALL bundle `@specsesh/agent/cloudflare` with wrangler.

#### Scenario: Examples import only public entries
- **WHEN** every import in `examples/*/` source is read
- **THEN** each `@specsesh/agent` import SHALL be one of the eight entries
- **AND** no import SHALL reach `packages/` by a relative path

### Requirement: Required dependencies are only the exact-pinned language packages and the schema library
The manifest's `dependencies` SHALL be exactly `@sf-agentscript/agentforce-dialect` `2.53.0`, `@sf-agentscript/agentscript-dialect` `3.4.0`, `@sf-agentscript/language` `3.2.3`, `@sf-agentscript/parser-javascript` `3.1.3` (see `core/authoring`) and `typebox` `1.3.27`, the schema library of `./openspec` and the version `@earendil-works/pi-ai` pins. No other package SHALL be a required dependency, and `zod` SHALL NOT be one.

#### Scenario: The language packages are pinned exactly
- **WHEN** the manifest's `dependencies` is read
- **THEN** its `@sf-agentscript/*` keys SHALL be exactly the four packages, at those versions

#### Scenario: The schema library is the only other dependency
- **WHEN** the manifest's `dependencies` is read
- **THEN** its keys SHALL be exactly the four `@sf-agentscript/*` packages and `typebox`, with `typebox` at `1.3.27`, an exact version, and no `zod`

### Requirement: The ontology entry loads from the packed tarball
The pack check SHALL import `@specsesh/agent/openspec` under plain Node from a project with no peers installed, and import it together with `@specsesh/agent/pi` from a project with the peers installed. In that second project exactly one version of `typebox` SHALL be installed.

#### Scenario: The ontology loads with no peers installed
- **GIVEN** the packed tarball installed alone in an empty project
- **WHEN** a script imports `@specsesh/agent/openspec` and checks a `Clause`
- **THEN** it SHALL run to completion

#### Scenario: One schema library beside pi
- **GIVEN** the packed tarball installed with the pi peers
- **WHEN** `npm ls typebox` runs in that project and a script imports `./openspec` and `./pi` together
- **THEN** `npm ls typebox` SHALL list exactly one version, `1.3.27`, and the script SHALL run to completion

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

### Requirement: Two packages publish at one version under Apache-2.0
`packages/agent/package.json` (`@specsesh/agent`) and `packages/specsesh/package.json` (`specsesh`) SHALL declare the same semver `version`, `license` `Apache-2.0`, `type` `module`, `engines.node` `>=22.19.0`, `repository` `{ "type": "git", "url": "git+https://github.com/jtaylorcpp/specsesh-agent.git", "directory": "packages/<dir>" }`, and SHALL NOT be `private`. Each SHALL ship an Apache 2.0 `LICENSE`. Every other workspace package SHALL be `private`.

#### Scenario: Both manifests identify their package
- **WHEN** both manifests are read
- **THEN** `name` SHALL be `@specsesh/agent` and `specsesh`, and `license`, `type`, `engines.node` and `repository.url` SHALL be as required
- **AND** both `version`s SHALL be equal and valid semver, and `private` SHALL be absent or `false`

#### Scenario: The license files are Apache 2.0
- **WHEN** `packages/agent/LICENSE` and `packages/specsesh/LICENSE` are read
- **THEN** each SHALL contain `Apache License` and `Version 2.0, January 2004`

#### Scenario: Only the two packages publish
- **WHEN** every other `package.json` in the workspace (root and `examples/*`) is read
- **THEN** each SHALL have `private: true`

### Requirement: specsesh carries the command and its Node dependencies
The `specsesh` manifest SHALL have `bin` exactly `{ "specsesh": "./bin/specsesh.js" }`, `files` `["bin", "README.md", "LICENSE"]`, `exports` exactly `{ "./package.json": "./package.json" }`, and `dependencies` exactly `@specsesh/agent` at `workspace:*` plus `@earendil-works/pi-ai`, `@earendil-works/pi-durable`, `@earendil-works/chord` and `@modelcontextprotocol/sdk`, each at the exact version in `@specsesh/agent`'s `devDependencies`. It SHALL have no `peerDependencies`.

#### Scenario: The specsesh manifest is exact
- **WHEN** `packages/specsesh/package.json` is read
- **THEN** `bin`, `files`, `exports` and the keys of `dependencies` SHALL be exactly as required, with no `peerDependencies`
- **AND** each dependency other than `@specsesh/agent` SHALL equal the same key in `packages/agent/package.json`'s `devDependencies`

### Requirement: The specsesh bin runs the cli entry
`packages/specsesh/bin/specsesh.js` SHALL start with `#!/usr/bin/env node`, import nothing but `@specsesh/agent/cli`, install `SIGINT` and `SIGTERM` handlers exiting `130` and `143`, and exit with the code `main(process.argv.slice(2))` resolves to. A thrown error SHALL print `<name>: <message>` to stderr and exit `1`.

#### Scenario: The bin imports only the cli entry
- **WHEN** `packages/specsesh/bin/specsesh.js` is read
- **THEN** its first line SHALL be `#!/usr/bin/env node` and its only import SHALL be `@specsesh/agent/cli`

#### Scenario: The workspace bin prints the version
- **GIVEN** a build of `packages/agent`
- **WHEN** `node packages/specsesh/bin/specsesh.js --version` runs in the workspace
- **THEN** it SHALL print `specsesh <version>`, `<version>` being both manifests' `version`, and exit `0`

### Requirement: Every bin is executable after a build
`packages/agent`'s `build` and `check` scripts SHALL end with `node scripts/chmod-bins.mjs`, which SHALL set mode `0755` on every target of the manifest's `bin` and exit `1` naming a target that does not exist. `packages/specsesh/bin/specsesh.js` SHALL be committed with git mode `100755`.

#### Scenario: Every built bin is executable
- **GIVEN** a build of `packages/agent`
- **WHEN** the mode of each target of the manifest's `bin` is read
- **THEN** each SHALL have the execute bit set for owner, group and others

#### Scenario: A built bin runs directly
- **GIVEN** a build of `packages/agent`
- **WHEN** `packages/agent/dist/bin/agentscript-task.js` is executed itself, not through `node`
- **THEN** it SHALL exit `2` with stderr beginning `usage:`

#### Scenario: A missing bin target is named
- **GIVEN** a manifest whose `bin` maps a name to a file that does not exist
- **WHEN** `node scripts/chmod-bins.mjs` runs against it
- **THEN** it SHALL exit `1` and stderr SHALL name that file

#### Scenario: The specsesh bin is committed executable
- **WHEN** `git ls-files -s packages/specsesh/bin/specsesh.js` is read
- **THEN** its mode SHALL be `100755`

### Requirement: The agent readme sends command-line users to specsesh
The first code block of `packages/agent/README.md` SHALL give `npm install -g specsesh` and `npx specsesh` for the command line, beside `npm install @specsesh/agent` and its Node peers for library use.

#### Scenario: The install block names specsesh
- **WHEN** the first fenced code block of `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install -g specsesh`, `npx specsesh` and `npm install @specsesh/agent`

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

### Requirement: pi-ai is imported statically
No file under `packages/agent/src/` SHALL import `@earendil-works/pi-ai` or a subpath of it with a dynamic `import()`. A module reached both statically and dynamically makes Bun's bundler wrap it in a lazy initialiser that can be dropped.

#### Scenario: No source imports pi-ai dynamically
- **WHEN** every file under `src/` is scanned, comments stripped
- **THEN** none SHALL contain a dynamic `import()` of `@earendil-works/pi-ai` or `@earendil-works/pi-ai/<subpath>`
