# core/authoring Specification

## Purpose
Parse, lint and edit an Agent Script document as text, never compile it. Analysis is error-tolerant: a half-written document yields diagnostics and a recovered tree, never an exception.

## Requirements

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

### Requirement: analyze parses with the Agentforce dialect and lints with its default rules
`analyze(source)` SHALL parse with `@sf-agentscript/parser-javascript`, interpret the tree with `@sf-agentscript/language`'s `Dialect` against `AgentforceSchema` (not the base dialect), and lint the unwrapped root with a `LintEngine` of `defaultRules()` (called) and `agentforceSchemaContext`. It SHALL return `{ source, parsed, diagnostics }`: the input byte-for-byte, the dialect's `{ value, diagnostics }` result (or `null`), and parse diagnostics followed by lint diagnostics.

#### Scenario: A clean document yields a parse and no diagnostics
- **GIVEN** a document with `config.agent_name`, a `system.instructions` block, a variable `stage` with a description, and a subagent `draft` whose prompt line interpolates `{!@variables.stage}`
- **WHEN** it is analysed
- **THEN** `analysis.source` SHALL equal the input
- **AND** `analysis.parsed` SHALL NOT be `null`
- **AND** the diagnostic messages SHALL be exactly `[]`

#### Scenario: Lint findings arrive alongside parse findings
- **GIVEN** the same document with the interpolation changed to `{!@variables.missing}`
- **WHEN** it is analysed
- **THEN** the diagnostic messages SHALL be exactly `["Variable 'stage' is declared but never used", "'missing' is not defined in variables"]`

#### Scenario: Lint reports an undeclared reference at its own position
- **GIVEN** a document declaring `stage` whose prompt line reads `{!@variables.change_id}`
- **WHEN** it is analysed
- **THEN** a diagnostic with code `undefined-reference` SHALL be present, its message mentioning `change_id`
- **AND** its range start line and character SHALL both be greater than 0

#### Scenario: Lint reports an unused variable
- **GIVEN** a document declaring `unread` that nothing references
- **WHEN** it is analysed
- **THEN** a diagnostic with code `unused-variable` SHALL be present

#### Scenario: Parse-stage diagnostics still reach the caller
- **GIVEN** `config:\n    nonexistent_field: "x"\n`
- **WHEN** it is analysed
- **THEN** some diagnostic message SHALL mention `nonexistent_field`

#### Scenario: The source is never normalised
- **GIVEN** `config:\n    agent_name: "spec-author"\n\n\n   \n`
- **WHEN** it is analysed
- **THEN** `analysis.source` SHALL be identical to the input

### Requirement: Identical diagnostics are reported once
`analyze` SHALL drop a diagnostic whose `code` (or `""` when absent), `message` and `range` (or `""` when absent), compared as JSON, equal those of an earlier diagnostic, keeping the first occurrence and the original order. Parse and lint both report schema violations, so without this an unknown field would appear twice.

#### Scenario: A schema violation reported by both stages appears once
- **GIVEN** a document whose unknown field is reported by both the parse and the lint stage with the same code, message and range
- **WHEN** it is analysed
- **THEN** exactly one such diagnostic SHALL be returned

#### Scenario: Same message on a different range is kept
- **GIVEN** two diagnostics with the same code and message on different ranges
- **WHEN** they are deduplicated
- **THEN** both SHALL be kept

### Requirement: analyze never throws and always explains a failure
`analyze` MUST NOT throw for any input string. A parse failure SHALL return `parsed: null` and one synthetic diagnostic `the document could not be parsed: <message>`. A lint failure SHALL keep the parse diagnostics and append `the document was parsed but could not be linted: <message>`. Synthetic diagnostics SHALL have `severity: 1` and the range 0:0–0:0.

#### Scenario: The lint input is guarded rather than cast
- **GIVEN** the dialect returns a wrapper whose `value` is not an object
- **WHEN** the input is analysed
- **THEN** the appended lint-failure diagnostic SHALL contain `returned no readable root`
- **GIVEN** a root lacking `__cst` or an array `__diagnostics`
- **THEN** the lint-failure diagnostic SHALL contain `upstream node shape has changed`
- **AND** the root SHALL be unwrapped with the same `documentRoot` predicate the interpreter uses

#### Scenario: Half-written documents yield diagnostics, not exceptions
- **GIVEN** each of `config:`, `config:\n    agent_type:`, `config:\n    agent_type: "unterminated`, a procedure ending in `if `, `variables:\n    stage: mutable string =`, and `\t\t\tnot even indentation that means anything`
- **WHEN** each is analysed
- **THEN** no call SHALL throw
- **AND** `analysis.source` SHALL equal the input
- **AND** there SHALL be at least one diagnostic, each with a non-empty string message

#### Scenario: A parser exception becomes a synthetic error diagnostic
- **GIVEN** the parser throws `Error("boom")` for an input
- **WHEN** the input is analysed
- **THEN** `parsed` SHALL be `null`
- **AND** the diagnostics SHALL be exactly one, with message `the document could not be parsed: boom`, severity 1 and range 0:0–0:0

#### Scenario: A lint exception keeps parse diagnostics and adds one
- **GIVEN** the parse succeeds with diagnostics D and the lint engine throws `Error("bad tree")`
- **WHEN** the input is analysed
- **THEN** the diagnostics SHALL be D followed by one with message `the document was parsed but could not be linted: bad tree` and severity 1

### Requirement: Diagnostics carry positions and parsing recovers past a problem
Each diagnostic `analyze` returns for a syntax error SHALL carry a non-empty message and a `range.start.line` number. After a problem, parsing SHALL continue at the dialect's recovery points (NEWLINE, DEDENT), so problems later in the file are still reported.

#### Scenario: A syntax error is positioned
- **GIVEN** `config:\n    agent_type: "unterminated\n`
- **WHEN** it is parsed
- **THEN** there SHALL be at least one diagnostic
- **AND** every diagnostic SHALL have a non-empty message and a numeric `range.start.line`

#### Scenario: A later problem is still found
- **GIVEN** `config:\n    agent_type: "unterminated\n\nvariables:\n    stage: not_a_type = 1\n`
- **WHEN** it is parsed
- **THEN** there SHALL be more than one diagnostic

### Requirement: parse returns a document and its diagnostics, even for a broken script
`parse(source)` SHALL return `{ document, diagnostics }`, where `document` is `new Document(source)` and `diagnostics` is `document.analysis.diagnostics`. It SHALL return a document for every input, including one that does not parse and the empty string.

#### Scenario: A broken script still yields its document
- **GIVEN** `config:\n    agent_type: "unterminated\n`
- **WHEN** it is parsed
- **THEN** `document` SHALL be defined, with `document.source` equal to the input
- **AND** `diagnostics` SHALL be non-empty

#### Scenario: The text survives byte-for-byte
- **GIVEN** each of: no trailing newline, trailing blank lines, tab indentation, trailing spaces, a multiline block with an inner blank line, an unparsable unterminated string, and `""`
- **WHEN** each is parsed
- **THEN** `document.source` SHALL be byte-identical (UTF-8) to the input

### Requirement: A Document's text is the artifact and its analysis follows every change
`Document` SHALL hold the source text as the artifact. `new Document(source = "")` SHALL analyse the initial text, and `source` SHALL return the current text. `analysis` SHALL return the `Analysis` of exactly the current text, recomputed on every `edit`, `undo` and `redo` that changes the text.

#### Scenario: Analysis follows edits and undo
- **GIVEN** a Document on a clean script
- **WHEN** `edit("config:\n    agent_type:")` is applied
- **THEN** `analysis.source` SHALL equal the new `source`
- **WHEN** `undo()` is applied
- **THEN** `analysis.source` SHALL equal the original script

#### Scenario: Default construction is empty
- **WHEN** `new Document()` is constructed
- **THEN** `source` SHALL be `""` and `canUndo` and `canRedo` SHALL be false

### Requirement: Document edit history works over whole-text snapshots
`Document.edit(next)` SHALL push the current text onto the history, clear the redo future, replace the text and re-analyse, unless `next` equals the current text, which is a no-op. `undo()` and `redo()` SHALL move one snapshot between history and future, doing nothing when there is nothing to move. All three SHALL return the document. `canUndo` and `canRedo` SHALL report whether history and future are non-empty.

#### Scenario: Undo and redo walk the snapshots
- **GIVEN** `new Document("config:\n")`, edited to the `"a"` text then to the `"b"` text
- **WHEN** `undo()` is applied twice
- **THEN** `source` SHALL contain `"a"` after the first and equal `config:\n` after the second
- **AND** `canUndo` SHALL be false
- **WHEN** `redo()` is applied
- **THEN** `source` SHALL contain `"a"` and `canRedo` SHALL be true

#### Scenario: A no-op edit records no history
- **GIVEN** `new Document("config:\n")`
- **WHEN** `edit("config:\n")` is applied
- **THEN** `canUndo` SHALL be false

#### Scenario: A new edit drops the redo future
- **GIVEN** `new Document("a")`, edited to `"b"` and undone
- **WHEN** `edit("c")` is applied
- **THEN** `canRedo` SHALL be false

#### Scenario: Undo and redo with nothing to move are no-ops
- **GIVEN** a fresh Document
- **WHEN** `undo()` then `redo()` are applied
- **THEN** `source` SHALL be unchanged and both SHALL return the same Document

#### Scenario: An edit and an undo restore every byte
- **GIVEN** a document parsed from `config:\n    agent_name: "spec-author"   \n\n`
- **WHEN** it is edited and then undone
- **THEN** `source` SHALL equal the original exactly

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
