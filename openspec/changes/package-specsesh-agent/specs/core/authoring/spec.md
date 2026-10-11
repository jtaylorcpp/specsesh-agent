## MODIFIED Requirements

### Requirement: The authoring entry exports parse, analyse and a document, and nothing that compiles
`@specsesh/agent/authoring` SHALL expose exactly the authoring surface: `analyze`, `parse`, `Document`, the type `Analysis`, and a re-export of `SUPPORTED_CONSTRUCTS` (with its type `SupportedConstruct`) from the interpreter's subset declaration. No export path advertised by the package manifest SHALL have a name matching `/compile|emit-runtime|salesforce/i`. The manifest SHALL advertise the entries `package/distribution` lists, and after `pnpm build` every advertised target file SHALL exist.

#### Scenario: A consumer imports the authoring surface
- **WHEN** a consumer imports `@specsesh/agent/authoring`
- **THEN** the module's keys SHALL include `Document`, `analyze`, `parse` and `SUPPORTED_CONSTRUCTS`
- **AND** `SUPPORTED_CONSTRUCTS` SHALL be the same declaration `@specsesh/agent/interpreter` reads, not a copy

#### Scenario: No export offers compilation
- **WHEN** the manifest's `exports` keys are listed
- **THEN** there SHALL be at least one
- **AND** none SHALL match `/compile|emit-runtime|salesforce/i`

#### Scenario: Every advertised entry point exists
- **WHEN** the package is built and each target in the manifest's `exports` is resolved against the package directory
- **THEN** each file SHALL exist on disk

### Requirement: The compiler is structurally unreachable
`@specsesh/agent` MUST NOT depend, directly or transitively, on `@sf-agentscript/agentforce` (the SDK carrying `compileSource()`) or `@sf-agentscript/compiler`, and its `src/` code MUST NOT call `compileSource(` or import either package; comments may discuss the compiler. `@sf-agentscript/agentforce-dialect` (schema and lint rules) is a legitimate dependency and SHALL NOT be mistaken for the compiler.

#### Scenario: Direct dependencies exclude the compiler
- **WHEN** the manifest's `dependencies`, `peerDependencies` and `optionalDependencies` are merged
- **THEN** neither `@sf-agentscript/agentforce` nor `@sf-agentscript/compiler` SHALL be a key

#### Scenario: The resolved tree excludes the compiler
- **WHEN** `pnpm ls --depth 10` runs in the package directory
- **THEN** its output SHALL NOT match `/@sf-agentscript\/agentforce(?!-dialect)/` nor `/@sf-agentscript\/compiler/`

#### Scenario: Source code neither calls nor imports the compiler
- **GIVEN** every `.ts` file under `src/`, read from disk (not from git), with block and line comments stripped
- **WHEN** the file set is scanned
- **THEN** the set SHALL be non-empty
- **AND** no file SHALL match `compileSource\s*\(`
- **AND** no file SHALL match an import `from "@sf-agentscript/agentforce"` (without `-dialect`) or `from "@sf-agentscript/compiler"`

### Requirement: Upstream dependencies are pinned exactly
Every dependency of `@specsesh/agent` whose name starts with `@sf-agentscript/` SHALL be declared with an exact `major.minor.patch` version (matching `/^\d+\.\d+\.\d+$/`), never a range. The current pins are `@sf-agentscript/agentforce-dialect` `2.53.0`, `@sf-agentscript/agentscript-dialect` `3.4.0`, `@sf-agentscript/language` `3.2.3` and `@sf-agentscript/parser-javascript` `3.1.3`.

#### Scenario: Every upstream dependency is exact
- **WHEN** the `@sf-agentscript/*` entries of the manifest's `dependencies` are listed
- **THEN** there SHALL be at least one
- **AND** each version SHALL match `/^\d+\.\d+\.\d+$/`

#### Scenario: A caret range is rejected
- **GIVEN** an `@sf-agentscript/*` dependency declared as `^3.2.3`
- **WHEN** the pin check runs
- **THEN** it SHALL fail naming that dependency as not pinned exactly

### Requirement: The package's test script runs subset conformance against the pinned upstream
The `test` script of `@specsesh/agent` SHALL run `scripts/check-subset-conformance.mjs` before the unit tests. The script SHALL read `SUPPORTED_CONSTRUCTS` from the text of `src/interpreter/subset.ts` (or the file named by `AGENTSCRIPT_SUBSET_FILE`) with no build step, check each probe parses with no diagnostics and produces every declared kind, and exit 0 only when nothing failed.

#### Scenario: Failure ids and output shape
- **WHEN** the script runs with `--json`
- **THEN** it SHALL print `{ pinned, checked, failures }`, with `checked` equal to the number of constructs
- **AND** a node kind produced by the probes that no construct declares SHALL fail under id `(subset)`
- **AND** a construct with an empty `kinds` list SHALL fail with a diagnostic containing `declares no node kinds`
- **AND** the exit code SHALL be 1 when `failures` is non-empty

#### Scenario: A declaration that is no longer a plain literal
- **GIVEN** a subset file with no `] as const;` after `export const SUPPORTED_CONSTRUCTS`
- **WHEN** the script runs
- **THEN** it SHALL fail, saying `SUPPORTED_CONSTRUCTS is no longer a plain array literal`

#### Scenario: Conformance passes at the current pin
- **WHEN** `node scripts/check-subset-conformance.mjs --json` runs against the installed versions
- **THEN** it SHALL exit 0
- **AND** `failures` SHALL be `[]`
- **AND** `checked` SHALL be greater than 0 and equal to `SUPPORTED_CONSTRUCTS.length`

#### Scenario: Conformance is wired into the test script
- **WHEN** the manifest's `scripts.test` is read
- **THEN** it SHALL contain `check-subset-conformance`

#### Scenario: A renamed node kind fails, naming its construct and why
- **GIVEN** a substituted subset file in which every `"ProcedureValue"` reads `"Procedure"`
- **WHEN** the conformance script runs against it
- **THEN** it SHALL exit non-zero
- **AND** `failures` SHALL include id `subagent.reasoning`, with diagnostics containing `Procedure` and naming `scan.ts` or `compose.ts`
- **AND** `failures` SHALL include id `(subset)`, because `ProcedureValue` is now produced but undeclared

#### Scenario: An empty kinds list fails
- **GIVEN** a substituted subset file in which `reasoning.structured-output` declares `kinds: []`
- **WHEN** the conformance script runs against it
- **THEN** it SHALL exit non-zero, with a failure for `reasoning.structured-output` whose diagnostics contain `declares no node kinds`

#### Scenario: A construct that no longer parses fails by id
- **GIVEN** a substituted subset file adding a construct `retired-construct` whose probe is `definitely_not_a_block:\n    nope: 1\n`
- **WHEN** the conformance script runs against it
- **THEN** it SHALL exit non-zero, with `retired-construct` among the failure ids

### Requirement: The core package imports only its declared dependencies and stays inside itself
Every import in `src/authoring/` and `src/interpreter/` SHALL resolve to an `@sf-agentscript/*` dependency, a Node builtin, or a file in those two directories. The relative-import closure from the `./authoring` and `./interpreter` export targets SHALL stay inside them and reach `run.ts`, `scan.ts` and `compose.ts`. Their source SHALL read no credential. Neither directory SHALL import from `src/pi/`, `src/claude-code/`, `src/durable/` or `src/cloudflare/`.

#### Scenario: The module graph closes inside the package
- **WHEN** relative imports are followed from the `./authoring` and `./interpreter` export targets, mapped back to their sources
- **THEN** more than one entry point SHALL be seeded
- **AND** every resolved file SHALL start with `src/authoring/` or `src/interpreter/` and exist
- **AND** `run.ts`, `scan.ts` and `compose.ts` SHALL be among the files reached

#### Scenario: Only declared dependencies are imported
- **WHEN** every bare import specifier in `src/authoring/` and `src/interpreter/` is reduced to its package name
- **THEN** each SHALL start with `@sf-agentscript/` or be a Node builtin

#### Scenario: No credential is read
- **WHEN** the source under `src/authoring/` and `src/interpreter/` is scanned with comments stripped
- **THEN** no file SHALL match `/process\.env|API_KEY|apiKey|ANTHROPIC_|OPENAI_|Bearer\s/i`

### Requirement: Every interpreter fixture is a document an author could save
Every string fixture exported by the interpreter's test fixtures module (`__tests__/core/helpers/fixtures.ts`) SHALL be registered in its `FIXTURES` table with the identical source and an expected lint result. A fixture marked `clean` SHALL produce no diagnostics at all, not even warnings or hints. Any other fixture SHALL produce exactly its listed messages. The deliberately broken fixtures `UNDECLARED_REFERENCE` and `UNTERMINATED_STRING` SHALL each carry at least one diagnostic of severity 1.

#### Scenario: Every exported fixture is registered
- **WHEN** the fixtures module's string exports are compared with `FIXTURES`' keys
- **THEN** there SHALL be more than five
- **AND** the two key sets SHALL be equal, each entry's `source` identical to its export

#### Scenario: A clean fixture produces nothing
- **WHEN** a fixture marked `clean` is analysed
- **THEN** its diagnostic messages SHALL be exactly `[]`

#### Scenario: The broken fixtures stay broken at error severity
- **WHEN** `UNDECLARED_REFERENCE` and `UNTERMINATED_STRING` are analysed
- **THEN** each SHALL have a diagnostic with `severity === 1`
