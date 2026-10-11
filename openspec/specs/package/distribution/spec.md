# package/distribution Specification

## Purpose
How the library is published: one npm package, `@specsesh/agent`, with an entry point per layer, built JavaScript and type declarations, optional peers for the layers that need them, and a check that the packed tarball installs and runs.

## Requirements

### Requirement: The package is @specsesh/agent 0.1.0 under Apache-2.0
`packages/agent/package.json` SHALL declare `name` `@specsesh/agent`, `version` `0.1.0`, `license` `Apache-2.0`, `type` `module`, `engines.node` `>=22.19.0`, and SHALL NOT be `private`. `packages/agent/LICENSE` SHALL hold the full Apache License 2.0 text. No other workspace package SHALL be publishable.

#### Scenario: The manifest identifies the package
- **WHEN** `packages/agent/package.json` is read
- **THEN** `name`, `version`, `license`, `type` and `engines.node` SHALL equal `@specsesh/agent`, `0.1.0`, `Apache-2.0`, `module` and `>=22.19.0`
- **AND** `private` SHALL be absent or `false`

#### Scenario: The license file is Apache 2.0
- **WHEN** `packages/agent/LICENSE` is read
- **THEN** it SHALL contain `Apache License` and `Version 2.0, January 2004`

#### Scenario: Only one package publishes
- **WHEN** every other `package.json` in the workspace (root and `examples/*`) is read
- **THEN** each SHALL have `private: true`

### Requirement: The package exports exactly eight entry points
The manifest's `exports` SHALL have exactly the keys `./authoring`, `./interpreter`, `./pi`, `./claude-code`, `./durable`, `./cloudflare`, `./openspec` and `./task`. Each SHALL map to `{ "types": "./dist/<entry>/index.d.ts", "import": "./dist/<entry>/index.js" }`. There SHALL be no root `.` export and no `./package.json` export, so a deep import such as `@specsesh/agent/dist/interpreter/run.js` is refused by Node.

#### Scenario: The exports map is exact
- **WHEN** the manifest's `exports` is read
- **THEN** its keys SHALL be exactly the eight entries, in that order
- **AND** `exports["./durable"]` SHALL equal `{ "types": "./dist/durable/index.d.ts", "import": "./dist/durable/index.js" }`
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

### Requirement: The three CLIs are compiled bins
The manifest's `bin` SHALL map `agentscript-pi` to `./dist/bin/agentscript-pi.js`, `agentscript-durable` to `./dist/bin/agentscript-durable.js` and `agentscript-task` to `./dist/bin/agentscript-task.js`. Each SHALL start with `#!/usr/bin/env node`. `tsx` SHALL NOT be a dependency or peer dependency, and no published file SHALL reference it.

#### Scenario: The bins are wired to compiled files
- **WHEN** the manifest's `bin` is read after a build
- **THEN** all three targets SHALL exist and start with `#!/usr/bin/env node`

#### Scenario: tsx is gone
- **WHEN** the manifest and every file under `dist/` are scanned
- **THEN** none SHALL mention `tsx`

### Requirement: The layer libraries are optional peers
`peerDependencies` SHALL be `@earendil-works/pi-ai`, `@earendil-works/pi-durable` and `@earendil-works/chord` at `^1.1.0`, and `agents` at `^0.28.0`, each marked `optional: true` in `peerDependenciesMeta`. The same packages SHALL be `devDependencies` at the versions the tests run on, so the workspace installs them.

#### Scenario: Every peer is optional
- **WHEN** the manifest's `peerDependencies` and `peerDependenciesMeta` are read
- **THEN** there SHALL be exactly the four peers at those ranges
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

### Requirement: Each layer imports only its own peers and the layers beneath it
`src/pi/` SHALL import only `@earendil-works/pi-ai`, Node builtins, the core directories and itself. `src/claude-code/` adds `src/pi/`. `src/durable/` adds `@earendil-works/pi-durable`, `@earendil-works/chord`, `src/claude-code/` and `src/openspec/`. `src/task/` adds `src/durable/`. Only `src/cloudflare/` SHALL import `agents` or `cloudflare:workers`, and it adds `src/durable/`. `src/openspec/` SHALL import only `typebox` and itself. `src/bin/` may import any layer.

#### Scenario: The layer graph holds
- **WHEN** every import under `src/pi/`, `src/claude-code/`, `src/durable/`, `src/task/`, `src/cloudflare/` and `src/openspec/` is reduced to a package name or a top-level `src/` directory
- **THEN** each directory's set SHALL be within the set this requirement allows it
- **AND** the scan SHALL have read at least one file in each directory

#### Scenario: Nothing outside cloudflare touches Workers
- **WHEN** every file under `src/` except `src/cloudflare/` is scanned
- **THEN** none SHALL import `agents`, `agents/*` or `cloudflare:workers`

#### Scenario: The durable layer records with the ontology
- **WHEN** the imports under `src/durable/` are reduced
- **THEN** they SHALL include `src/openspec`, the ontology its host actions build their Action and Evidence records with
- **AND** they SHALL NOT include `typebox`, which only `src/openspec/` imports

### Requirement: No published text names the old package
No file under `packages/agent/src/` or `packages/agent/dist/`, and neither `README.md` nor `package.json`, SHALL contain `@coopcli`.

#### Scenario: The old name is gone
- **WHEN** those files are scanned after a build
- **THEN** the set scanned SHALL be non-empty
- **AND** no file SHALL contain `@coopcli`

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the eight entry points with one line each on what they hold and which peers they need, and name all three bins.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the eight `@specsesh/agent/<entry>` strings, `agentscript-pi`, `agentscript-durable` and `agentscript-task`

### Requirement: pack:check proves the tarball installs and runs
`pnpm pack:check` SHALL run `__tests__/package/pack.test.ts` under vitest (`vitest.pack.config.ts`; not in `pnpm test`: it needs the npm registry). It SHALL pack the built package, install it into temp projects with and without the peers, import every entry but `./cloudflare` with plain Node, run the installed `agentscript-durable run` on a faux model to `completed` and `agentscript-task` to its usage, name what failed, and clean up.

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
