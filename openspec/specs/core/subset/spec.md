# core/subset Specification

## Purpose
The one declaration of which Agent Script constructs this runtime executes, and the pre-execution scan that refuses everything outside it, by name and position, before anything runs.

## Requirements

### Requirement: The supported subset is declared once, as SUPPORTED_CONSTRUCTS
The `./interpreter` export SHALL declare the executable subset once: `SUPPORTED_CONSTRUCTS`, a plain array literal closed by `] as const;` in `src/interpreter/subset.ts`, with no second declaration in `src/`. Each entry SHALL be `{ id, summary, probe, kinds }`: a stable id, a summary, a probe that parses clean and produces every declared kind, and a non-empty list of node kinds. `SUPPORTED_CONSTRUCT_IDS` SHALL list the ids in order.

#### Scenario: The ten constructs, in order
- **WHEN** `SUPPORTED_CONSTRUCT_IDS` is read
- **THEN** it SHALL equal `["config", "system.instructions", "variables", "variables.description", "subagent", "subagent.reasoning", "reasoning.prompt-line", "reasoning.interpolation", "reasoning.logic-line", "reasoning.structured-output"]`

#### Scenario: Each construct declares its kinds
- **WHEN** each construct's `kinds` is read
- **THEN** the entries SHALL be exactly:
  - `config`: `["ConfigBlock"]`
  - `system.instructions`: `["SystemBlock", "TemplateExpression", "TemplateText"]`
  - `variables`: `["VariablesBlock", "VariableDeclaration", "ParameterDeclaration", "Identifier", "StringLiteral", "BooleanLiteral"]`
  - `variables.description`: `["VariablePropertiesBlock"]`
  - `subagent`: `["Collection<SubagentBlock>", "SubagentBlock"]`
  - `subagent.reasoning`: `["ReasoningBlock", "ProcedureValue"]`
  - `reasoning.prompt-line`: `["Template", "TemplateText"]`
  - `reasoning.interpolation`: `["TemplateInterpolation"]`
  - `reasoning.logic-line`: `["IfStatement", "SetClause", "MemberExpression", "AtIdentifier", "ComparisonExpression", "BinaryExpression", "UnaryExpression", "StringLiteral", "NumberLiteral", "BooleanLiteral"]`
  - `reasoning.structured-output`: `["SetClause", "MemberExpression", "AtIdentifier"]`
- **AND** no construct's `kinds` SHALL be empty

#### Scenario: Each construct's summary
- **WHEN** each construct's `summary` is read
- **THEN** the entries SHALL be:
  - `config`: `the config block naming the agent`
  - `system.instructions`: `standing instructions, as a multiline block`
  - `variables`: `declared variables with a type and a literal default`
  - `variables.description`: `a variable's description`
  - `subagent`: `a named subagent with a description`
  - `subagent.reasoning`: `a subagent's reasoning block`
  - `reasoning.prompt-line`: `a prompt line, interpreted by the model`
  - `reasoning.interpolation`: ``a `{!@variables.x}` reference inside a prompt line``
  - `reasoning.logic-line`: `a logic line, run deterministically every turn`
  - `reasoning.structured-output`: `assigning a variable from a field of the step's structured result`

#### Scenario: Probes exercise their constructs fully
- **WHEN** the probes are read
- **THEN** the `variables` probe SHALL declare a `mutable` string, a bare `name: type = value` parameter and a `mutable boolean = False`, so both `VariableDeclaration` and `ParameterDeclaration` are produced
- **AND** the `reasoning.interpolation` probe SHALL use `{!@variables.stage}` (with the `!`)
- **AND** the `reasoning.logic-line` probe SHALL contain `if not @variables.approved and @variables.count > 1:`, a prompt line, `else:` and `set @variables.stage = "specs"`
- **AND** the `reasoning.structured-output` probe SHALL contain `set @variables.verdict = @outputs.verdict` (plural `@outputs`)

#### Scenario: Exactly one declaration exists
- **WHEN** every `.ts` file under the package's `src/`, read from disk, is searched for `(const|let|var) SUPPORTED_CONSTRUCTS (:|=)`
- **THEN** the only match SHALL be `src/interpreter/subset.ts`

### Requirement: The subset is rendered from the declaration, never restated
`renderSubsetMarkdown()` SHALL return one line per construct, in declaration order, formatted as `` - `<id>` — <summary> `` and joined by `\n`. `renderSubsetInline()` SHALL return the ids joined by `", "`. The package README's block between `<!-- SUBSET:BEGIN` and `<!-- SUBSET:END` (after the opening comment's `-->`, trimmed) SHALL be character-identical to `renderSubsetMarkdown()`. Every refusal message SHALL embed `renderSubsetInline()`.

#### Scenario: Markdown rendering
- **WHEN** `renderSubsetMarkdown()` is called
- **THEN** its first line SHALL be `` - `config` — the config block naming the agent ``
- **AND** it SHALL have exactly `SUPPORTED_CONSTRUCTS.length` lines

#### Scenario: Inline rendering
- **WHEN** `renderSubsetInline()` is called
- **THEN** it SHALL start with `config, system.instructions, variables, variables.description, subagent, ...` and end with `reasoning.structured-output`

#### Scenario: The README matches the export
- **WHEN** the README's generated SUBSET block is extracted
- **THEN** it SHALL equal `renderSubsetMarkdown()`

#### Scenario: A refusal names every supported construct
- **WHEN** a document with an unsupported block is run
- **THEN** the first finding's message SHALL contain every id in `SUPPORTED_CONSTRUCT_IDS`

### Requirement: Supported block fields are named per block
`SUPPORTED_BLOCK_FIELDS` SHALL name the authored fields each supported block may carry, and the scan SHALL refuse any other field even when the block's node kind is supported. `agent_name` MUST stay allowed, because the Agentforce dialect requires `agent_name` or `developer_name`. Nothing in the runtime reads a `config` value.

#### Scenario: The field table
- **WHEN** `SUPPORTED_BLOCK_FIELDS` is read
- **THEN** it SHALL be exactly:
  - `Document` (the dialect's root object, not a node kind): `config`, `system`, `variables`, `subagent`
  - `ConfigBlock`: `agent_name`, `developer_name`, `agent_type`, `description`
  - `SystemBlock`: `instructions`
  - `VariableDeclaration` and `ParameterDeclaration`: `properties` (the dialect files a variable's `description:` under this synthetic field)
  - `VariablePropertiesBlock`: `description`
  - `SubagentBlock`: `description`, `reasoning`
  - `ReasoningBlock`: `instructions`

#### Scenario: A config with agent_name is accepted
- **GIVEN** `config:\n    agent_name: "spec-author"\n`
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported for `config`

#### Scenario: A subagent-level system block is refused
- **GIVEN** a subagent `t` carrying its own `system:` block (kind `SystemBlock`, which is supported at the document level)
- **WHEN** the document is scanned
- **THEN** a finding with construct `system` and where `subagent "t"` SHALL be reported

#### Scenario: An unknown top-level block is refused
- **GIVEN** a document with a top-level `model_config:` block
- **WHEN** it is scanned
- **THEN** a finding with construct `model_config` and where `the document` SHALL be reported

#### Scenario: An unknown field in a supported block is refused
- **GIVEN** a subagent `t` with a field other than `description` or `reasoning` (e.g. `actions:`)
- **WHEN** the document is scanned
- **THEN** a finding naming that field, with where `subagent "t"`, SHALL be reported

### Requirement: Statements, expressions and defaults are limited to declared kinds
The scan SHALL admit statements only of `SUPPORTED_STATEMENT_KINDS`, expressions only of `SUPPORTED_EXPRESSION_KINDS`, defaults only of `SUPPORTED_DEFAULT_VALUE_KINDS` (exactly the literal kinds the declaration reader reads), `reasoning.instructions` only as a `ProcedureValue`, and template parts only as `TemplateText` or `TemplateInterpolation`, whose expression is scanned as a read. `Identifier` SHALL NOT be an expression kind.

#### Scenario: The kind lists
- **WHEN** the lists are read
- **THEN** `SUPPORTED_STATEMENT_KINDS` SHALL be `["Template", "IfStatement", "SetClause"]`
- **AND** `SUPPORTED_EXPRESSION_KINDS` SHALL be `["MemberExpression", "AtIdentifier", "ComparisonExpression", "BinaryExpression", "UnaryExpression", "StringLiteral", "NumberLiteral", "BooleanLiteral"]`
- **AND** `SUPPORTED_DEFAULT_VALUE_KINDS` SHALL be `["StringLiteral", "NumberLiteral", "BooleanLiteral"]`

#### Scenario: Statement and expression kinds are inside the declared kinds
- **WHEN** `SUPPORTED_STATEMENT_KINDS` and `SUPPORTED_EXPRESSION_KINDS` are compared with the union of every construct's `kinds`
- **THEN** every listed kind SHALL be declared by some construct
- **AND** every listed kind SHALL appear in `SUPPORTED_NODE_KINDS`

#### Scenario: SUPPORTED_NODE_KINDS is the deduplicated union
- **WHEN** `SUPPORTED_NODE_KINDS` is read
- **THEN** it SHALL equal the deduplicated union, in first-seen order, of every construct's `kinds`, then `SUPPORTED_STATEMENT_KINDS`, then `SUPPORTED_EXPRESSION_KINDS`

#### Scenario: The scan and the reader admit the same defaults
- **GIVEN** variables defaulted to `"x"`, `3`, `True` and `False`
- **WHEN** their declarations are read
- **THEN** their initial values SHALL be `"x"`, `3`, `true` and `false`
- **AND** `SUPPORTED_DEFAULT_VALUE_KINDS` sorted SHALL equal `["BooleanLiteral", "NumberLiteral", "StringLiteral"]`

#### Scenario: A default built from an expression is refused, not dropped
- **GIVEN** a variable `b` whose default is `@variables.a`
- **WHEN** the document is run
- **THEN** it SHALL be refused with `UnsupportedConstructError` before any dispatch, carrying exactly one finding
- **AND** that finding SHALL have where `variable "b"`, construct `MemberExpression as a variable's default`, and a range starting on 0-based line 2

#### Scenario: A variable with no default is refused
- **GIVEN** a variable `v` declared with a type but no `= value`
- **WHEN** the document is scanned
- **THEN** a finding with construct `v (a variable with no declared value)` and where `variable "v"` SHALL be reported

#### Scenario: A bare name in a value position is refused in the author's words
- **GIVEN** a condition or assigned value that is a bare identifier `foo`
- **WHEN** the document is scanned
- **THEN** the finding's construct SHALL be `the bare name foo`, not `Identifier`

#### Scenario: A non-procedure instructions value is refused
- **GIVEN** a subagent whose `reasoning.instructions` is not an `instructions: ->` procedure
- **WHEN** the document is scanned
- **THEN** a finding naming the value's kind (or `instructions` if it has none) SHALL be reported for that subagent

#### Scenario: An unknown statement kind is refused
- **GIVEN** a procedure containing a statement whose kind is not in `SUPPORTED_STATEMENT_KINDS`
- **WHEN** the document is scanned
- **THEN** a finding naming that kind, or `an unparsed instruction` when it has none, SHALL be reported

### Requirement: Only @variables may be read or written, and @outputs only as a set's whole value
Expressions SHALL read only `READABLE_NAMESPACES` (`["variables"]`) and a `set` SHALL write only `ASSIGNABLE_NAMESPACES` (`["variables"]`). `STRUCTURED_RESULT_NAMESPACE` SHALL be `"outputs"` (plural), admitted only as the entire value of a `set` and refused anywhere else. A namespace with no field after it SHALL be refused as `@<name>`.

#### Scenario: Writing another namespace is refused
- **GIVEN** a subagent `review` containing `set @context.x = "y"`
- **WHEN** the document is scanned
- **THEN** a finding with construct `set @context` and where `subagent "review"` SHALL be reported

#### Scenario: Reading another namespace in an interpolation is refused
- **GIVEN** a prompt line containing `{!@context.x}`
- **WHEN** the document is scanned
- **THEN** a finding with construct `@context` SHALL be reported, and it SHALL NOT be composed into a prompt

#### Scenario: @outputs as a set's value is accepted
- **GIVEN** `set @variables.verdict = @outputs.verdict`
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported for it

#### Scenario: @outputs inside a condition is refused
- **GIVEN** `if @outputs.verdict == "ok":`
- **WHEN** the document is scanned
- **THEN** a finding with construct `@outputs` SHALL be reported

#### Scenario: A set target that is not a member expression is refused
- **GIVEN** a `set` whose target is not `@<namespace>.<field>`
- **WHEN** the document is scanned
- **THEN** a finding naming the target's kind, or `an assignment target`, SHALL be reported

### Requirement: Operators are limited to the declared sets
Comparisons SHALL use only `SUPPORTED_COMPARISON_OPERATORS` = `["==", "!=", "<", "<=", ">", ">="]`. Joins SHALL use only `SUPPORTED_BINARY_OPERATORS` = `["and", "or"]`. Negation SHALL use only `SUPPORTED_UNARY_OPERATORS` = `["not"]`. Any other operator SHALL be refused with construct `the operator <op>`, and the operands SHALL still be scanned.

#### Scenario: Supported operators pass
- **GIVEN** `if not @variables.approved and @variables.count > 1:`
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported

#### Scenario: An unknown operator is refused by name
- **GIVEN** a comparison, binary or unary expression whose operator is outside its set (e.g. `+`)
- **WHEN** the document is scanned
- **THEN** a finding with construct `the operator +` SHALL be reported

### Requirement: Booleans are spelled the dialect's way when written back
`BOOLEAN_LITERALS` SHALL be `{ true: "True", false: "False" }`, the only boolean spellings the dialect accepts. Lower-case `true`/`false` are lint errors in the dialect and SHALL NOT be accepted as boolean expressions, since they parse as `Identifier`.

#### Scenario: The literal table
- **WHEN** `BOOLEAN_LITERALS` is read
- **THEN** `true` SHALL map to `True` and `false` to `False`

#### Scenario: Lower-case true is not a boolean
- **GIVEN** `if @variables.approved == true:`
- **WHEN** the document is scanned
- **THEN** a finding with construct `the bare name true` SHALL be reported

### Requirement: The scan walks the whole document up front and reports every finding
`scanDocument(parsed)` SHALL accept the dialect's wrapper or the root, return `[]` with no root, and walk the whole document from its authored `__children`, including subagents and branches a run never enters, reporting every unsupported construct without short-circuiting. An empty result means only that every construct is implemented. `run` and `start` SHALL scan before any dispatch and throw `UnsupportedConstructError` with every finding.

#### Scenario: Two unsupported constructs are both reported
- **GIVEN** a document containing a `model_config:` block and a `set @context...` line, alongside supported prompt lines and a supported `set`
- **WHEN** it is run with a recording port
- **THEN** it SHALL reject with `UnsupportedConstructError`
- **AND** the sorted constructs SHALL be exactly `["model_config", "set @context"]`
- **AND** the port SHALL have received zero requests

#### Scenario: An unsupported construct on an unreached subagent is refused up front
- **GIVEN** a document whose subagent `review` contains `set @context...`, run with `entry: "draft"`
- **WHEN** it is run
- **THEN** it SHALL reject before any dispatch with a finding of where `subagent "review"` and construct `set @context`

#### Scenario: The wrapper and the root give the same answer
- **GIVEN** a document with one unsupported block
- **WHEN** `scanDocument` is called once with the `{ value, diagnostics }` wrapper and once with its `value`
- **THEN** both results SHALL contain the same finding

#### Scenario: No root means no findings
- **WHEN** `scanDocument(null)` is called
- **THEN** it SHALL return `[]`

### Requirement: A refusal says the construct is unsupported by this runtime, where and in which block
Each `UnsupportedConstruct` SHALL carry `construct` (in the author's vocabulary), `range`, `where` (`the document`, `config`, `system`, `variable "<name>"` or `subagent "<name>"`) and `message`. The message SHALL say the construct is `unsupported by this runtime` and `may well be valid Agent Script`, end with `Supported: <renderSubsetInline()>.`, and never call the document invalid. The position SHALL be 1-based, or `at a position the parser did not report` when unknown.

#### Scenario: The exact message and error shape
- **WHEN** a finding is reported
- **THEN** its message SHALL read `<construct> <at>, in <where>, is unsupported by this runtime. It may well be valid Agent Script — @coopcli/agentscript implements an enumerated subset and does not execute this construct. Supported: <ids>.`, with `<at>` = `at <line+1>:<character+1>` from the key's range, else the child's span, else the value's span
- **AND** `UnsupportedConstructError` SHALL have name `UnsupportedConstructError`, carry `constructs`, and have message `this runtime does not implement <n> construct(s) used by the document:` followed by one `  - <message>` line per finding

#### Scenario: An unsupported block is named with its real position
- **GIVEN** a document whose `model_config:` starts on source line 4, column 1 (the block lints clean under the pinned dialect)
- **WHEN** it is run
- **THEN** a finding with construct `model_config` SHALL have range start `{ line: 3, character: 0 }`
- **AND** its message SHALL contain `4:1`, `unsupported by this runtime` and `may well be valid Agent Script`
- **AND** it SHALL NOT match `/invalid Agent Script/i`

#### Scenario: Every real refusal carries a real position
- **GIVEN** each of the unsupported-block, unreached-branch and two-unsupported fixtures
- **WHEN** each is run
- **THEN** every finding's range start line plus character SHALL be greater than 0
- **AND** every message SHALL contain `<line+1>:<character+1>`

#### Scenario: A missing position is said, not invented
- **GIVEN** a root `{ __children: [{ key: "mystery_block", value: {} }], mystery_block: {} }` with no spans
- **WHEN** it is scanned
- **THEN** there SHALL be exactly one finding, with range start `{ line: 0, character: 0 }`
- **AND** its message SHALL contain `a position the parser did not report` and SHALL NOT contain `at 1:1`

#### Scenario: The error aggregates its findings
- **GIVEN** a scan with two findings
- **WHEN** `UnsupportedConstructError` is constructed from them
- **THEN** `name` SHALL be `UnsupportedConstructError`
- **AND** `constructs` SHALL hold both
- **AND** the message SHALL start `this runtime does not implement 2 construct(s) used by the document:` and list both messages
