## ADDED Requirements

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
