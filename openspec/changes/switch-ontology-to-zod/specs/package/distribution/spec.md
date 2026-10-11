## REMOVED Requirements

### Requirement: Required dependencies are only the exact-pinned language packages and TypeBox
**Reason**: The ontology's schema library is now zod, not TypeBox.
**Migration**: See "Required dependencies are only the exact-pinned language packages and zod".

## ADDED Requirements

### Requirement: Required dependencies are only the exact-pinned language packages and zod
The manifest's `dependencies` SHALL be exactly `@sf-agentscript/agentforce-dialect` `2.53.0`, `@sf-agentscript/agentscript-dialect` `3.4.0`, `@sf-agentscript/language` `3.2.3`, `@sf-agentscript/parser-javascript` `3.1.3` (see `core/authoring`) and `zod` `4.6.5`, the schema library of `./openspec` and the version `@earendil-works/pi-ai` declares as its peer. No other package SHALL be a required dependency, and `typebox` SHALL NOT be one.

#### Scenario: The language packages, all exact
- **WHEN** the manifest's `dependencies` is read
- **THEN** its `@sf-agentscript/*` keys SHALL be exactly the four packages, at those versions

#### Scenario: zod is the only other dependency
- **WHEN** the manifest's `dependencies` is read
- **THEN** its keys SHALL be exactly the four `@sf-agentscript/*` packages and `zod`, with `zod` at `4.6.5`, an exact version, and no `typebox`

### Requirement: The ontology entry imports from the packed tarball
The pack check SHALL import `@specsesh/agent/openspec` under plain Node from a project with no peers installed, and import it together with `@specsesh/agent/pi` from a project with the peers installed. In that second project exactly one version of `zod` SHALL be installed.

#### Scenario: The ontology loads with no peers
- **GIVEN** the packed tarball installed alone in an empty project
- **WHEN** a script imports `@specsesh/agent/openspec` and checks a `Clause`
- **THEN** it SHALL run to completion

#### Scenario: One zod beside pi
- **GIVEN** the packed tarball installed with the pi peers
- **WHEN** `npm ls zod` runs in that project and a script imports `./openspec` and `./pi` together
- **THEN** `npm ls zod` SHALL list exactly one version, `4.6.5`, and the script SHALL run to completion
