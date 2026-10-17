## REMOVED Requirements

### Requirement: The package is @specsesh/agent 0.1.0 under Apache-2.0
**Reason**: A second package, `specsesh`, publishes beside it, and the version moves with each release instead of being pinned in the spec.
**Migration**: See "Two packages publish at one version under Apache-2.0".

## ADDED Requirements

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
The `specsesh` manifest SHALL have `bin` exactly `{ "specsesh": "./bin/specsesh.js" }`, `files` `["bin", "README.md", "LICENSE"]`, `exports` exactly `{ "./package.json": "./package.json" }`, and `dependencies` exactly `@specsesh/agent` at `workspace:*` and `@earendil-works/pi-ai`, `@earendil-works/pi-durable` and `@earendil-works/chord` each at the exact version in `@specsesh/agent`'s `devDependencies`. It SHALL have no `peerDependencies`.

#### Scenario: The specsesh manifest is exact
- **WHEN** `packages/specsesh/package.json` is read
- **THEN** `bin`, `files`, `exports` and the keys of `dependencies` SHALL be exactly as required, with no `peerDependencies`
- **AND** each `@earendil-works/*` dependency SHALL equal the same key in `packages/agent/package.json`'s `devDependencies`

### Requirement: The specsesh bin runs the cli entry
`packages/specsesh/bin/specsesh.js` SHALL start with `#!/usr/bin/env node`, import nothing but `@specsesh/agent/cli`, install `SIGINT` and `SIGTERM` handlers exiting `130` and `143`, and exit with the code `main(process.argv.slice(2))` resolves to. A thrown error SHALL print `<name>: <message>` to stderr and exit `1`.

#### Scenario: The bin imports only the cli entry
- **WHEN** `packages/specsesh/bin/specsesh.js` is read
- **THEN** its first line SHALL be `#!/usr/bin/env node` and its only import SHALL be `@specsesh/agent/cli`

#### Scenario: The workspace bin prints the version
- **GIVEN** a build of `packages/agent`
- **WHEN** `node packages/specsesh/bin/specsesh.js --version` runs in the workspace
- **THEN** it SHALL print `specsesh <version>`, `<version>` being both manifests' `version`, and exit `0`

## MODIFIED Requirements

### Requirement: The readme lists the entry points
`packages/agent/README.md` SHALL give the install command `npm install @specsesh/agent`, list the ten entry points with one line each on what they hold and which peers they need, name all four bins, and point at `npx specsesh`. `packages/specsesh/README.md` SHALL give `npx specsesh --help`, `npm install --save-dev specsesh`, the four commands `agent`, `durable`, `task` and `change`, and Node `22.19`.

#### Scenario: Every entry is documented
- **WHEN** `packages/agent/README.md` is read
- **THEN** it SHALL contain `npm install @specsesh/agent`, each of the ten `@specsesh/agent/<entry>` strings, `agentscript-pi`, `agentscript-durable`, `agentscript-task`, `agentscript-change` and `npx specsesh`

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
