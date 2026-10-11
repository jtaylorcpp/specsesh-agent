## MODIFIED Requirements

### Requirement: The supported subset is declared once, as SUPPORTED_CONSTRUCTS
`@specsesh/agent/interpreter` SHALL declare the executable subset once: `SUPPORTED_CONSTRUCTS`, a plain array literal closed by `] as const;` in `src/interpreter/subset.ts`, with no second declaration in `src/`. Each entry SHALL be `{ id, summary, probe, kinds }`: a stable id, a summary, a probe that parses clean and produces every declared kind, and a non-empty list of node kinds. `SUPPORTED_CONSTRUCT_IDS` SHALL list the ids in order.

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

### Requirement: A refusal says the construct is unsupported by this runtime, where and in which block
Each `UnsupportedConstruct` SHALL carry `construct` (in the author's vocabulary), `range`, `where` (`the document`, `config`, `system`, `variable "<name>"` or `subagent "<name>"`) and `message`. The message SHALL say the construct is `unsupported by this runtime` and `may well be valid Agent Script`, end with `Supported: <renderSubsetInline()>.`, and never call the document invalid. The position SHALL be 1-based, or `at a position the parser did not report` when unknown.

#### Scenario: The exact message and error shape
- **WHEN** a finding is reported
- **THEN** its message SHALL read `<construct> <at>, in <where>, is unsupported by this runtime. It may well be valid Agent Script — @specsesh/agent implements an enumerated subset and does not execute this construct. Supported: <ids>.`, with `<at>` = `at <line+1>:<character+1>` from the key's range, else the child's span, else the value's span
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
