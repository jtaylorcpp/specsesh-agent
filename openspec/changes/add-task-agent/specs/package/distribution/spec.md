## RENAMED Requirements

- FROM: `### Requirement: The package exports exactly seven entry points`
- TO: `### Requirement: The package exports exactly eight entry points`

- FROM: `### Requirement: The two CLIs are compiled bins`
- TO: `### Requirement: The three CLIs are compiled bins`

## MODIFIED Requirements

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

### Requirement: The three CLIs are compiled bins
The manifest's `bin` SHALL map `agentscript-pi` to `./dist/bin/agentscript-pi.js`, `agentscript-durable` to `./dist/bin/agentscript-durable.js` and `agentscript-task` to `./dist/bin/agentscript-task.js`. Each SHALL start with `#!/usr/bin/env node`. `tsx` SHALL NOT be a dependency or peer dependency, and no published file SHALL reference it.

#### Scenario: The bins are wired to compiled files
- **WHEN** the manifest's `bin` is read after a build
- **THEN** all three targets SHALL exist and start with `#!/usr/bin/env node`

#### Scenario: tsx is gone
- **WHEN** the manifest and every file under `dist/` are scanned
- **THEN** none SHALL mention `tsx`

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

### Requirement: Each layer imports only its own peers and the layers beneath it
`src/pi/` SHALL import only `@earendil-works/pi-ai`, Node builtins, the core directories and itself. `src/claude-code/` adds `src/pi/`. `src/durable/` adds `@earendil-works/pi-durable`, `@earendil-works/chord`, `src/claude-code/` and `src/openspec/`. `src/task/` adds `src/durable/`. Only `src/cloudflare/` SHALL import `agents` or `cloudflare:workers`, and it adds `src/durable/`. `src/openspec/` SHALL import only `zod` and itself. `src/bin/` may import any layer.

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
- **AND** they SHALL NOT include `zod`, which only `src/openspec/` imports

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the eight entry points with one line each on what they hold and which peers they need, and name all three bins.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the eight `@specsesh/agent/<entry>` strings, `agentscript-pi`, `agentscript-durable` and `agentscript-task`

### Requirement: pack:check proves the tarball installs and runs
`pnpm pack:check` SHALL run `packages/agent/__tests__/package/pack.test.ts` under vitest (config `vitest.pack.config.ts`; not part of `pnpm test`, because it needs the npm registry). It SHALL `npm pack` the built package, install the tarball into fresh temp projects with and without the peers, import every entry except `./cloudflare` with plain Node, run the installed `agentscript-durable run` on a faux model to `completed` and the installed `agentscript-task` to its usage, fail naming what failed, and delete its temp directories.

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
