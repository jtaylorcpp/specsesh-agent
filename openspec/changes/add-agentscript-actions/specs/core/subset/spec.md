## ADDED Requirements

### Requirement: An action is defined on its subagent
A subagent's `actions:` block SHALL define each action as an `ActionBlock` with `description` (a string), `inputs` and `outputs` (each a block of `<name>: <type>` declarations with no default, the type being `string`, `number` or `boolean`) and `target` (a string). An input or output of any other type, or with a default, SHALL be refused by name. `inputs` and `outputs` MAY be absent, meaning none.

#### Scenario: A well-formed action scans clean
- **GIVEN** a subagent defining `run_checks` with `inputs: task_id: string`, `outputs: passed: boolean` and `output: string`, and `target: "mcpTool://run_checks"`
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported for the definition

#### Scenario: A list-typed output is refused
- **GIVEN** an action whose output is declared `files: list[string]`
- **WHEN** the document is scanned
- **THEN** a finding naming `files` SHALL be reported for that subagent

### Requirement: Only mcpTool targets execute
An action's `target` SHALL be `mcpTool://<name>`, with a non-empty `<name>` naming a tool the host provides. Every other scheme the dialect accepts (`flow://`, `apex://`, `standardInvocableAction://` and the rest) SHALL be refused, with construct `target <scheme>://`, as unsupported by this runtime. The dialect itself rejects unknown schemes such as `host://` as lint errors.

#### Scenario: An mcpTool target is accepted
- **GIVEN** `target: "mcpTool://run_checks"`
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported for the target

#### Scenario: A flow target is refused by this runtime
- **GIVEN** `target: "flow://RunTests"`, which lints clean
- **WHEN** the document is scanned
- **THEN** a finding with construct `target flow://` SHALL be reported, its message saying it is unsupported by this runtime

#### Scenario: A host scheme never reaches the scan
- **GIVEN** `target: "host://command"`
- **WHEN** the document is run
- **THEN** it SHALL be refused with `UnparsedDocumentError`, because the dialect reports `unsupported target scheme "host://"` as an error

### Requirement: A run statement calls an action deterministically
A `run @actions.<name>` statement SHALL hold, beneath it, `with <input> = <expression>` clauses and `set @variables.<v> = @outputs.<field>` clauses. Every declared input MUST be given exactly once, by an expression of `SUPPORTED_EXPRESSION_KINDS`; `...` is refused in a `run`. A `with` naming an undeclared input, or a `set` reading an undeclared output field, SHALL be refused by name.

#### Scenario: A complete run statement scans clean
- **GIVEN** `run @actions.run_checks` with `with task_id = @variables.task_id` and `set @variables.checks_passed = @outputs.passed`
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported for it

#### Scenario: A missing input is refused
- **GIVEN** an action declaring inputs `path` and `content`, called by a `run` with only `with path = "a.ts"`
- **WHEN** the document is scanned
- **THEN** a finding naming the missing input `content` SHALL be reported

#### Scenario: A model-filled input in a run is refused
- **GIVEN** `run @actions.run_checks` with `with task_id = ...`
- **WHEN** the document is scanned
- **THEN** a finding with construct `Ellipsis` SHALL be reported, because nothing in a `run` is filled by a model

### Requirement: A subagent that runs actions is deterministic
A subagent containing a `run` statement anywhere in its procedure (including inside an `if`) SHALL contain only logic lines and `run` statements. A prompt line, a `set … = @outputs.<f>` outside a `run`, or a `reasoning.actions` block in the same subagent SHALL be refused, with where naming the subagent, so a subagent is never half a model step and half a program.

#### Scenario: A run beside a prompt line is refused
- **GIVEN** a subagent with `| Fix it.` and `run @actions.run_checks` in the same procedure
- **WHEN** the document is scanned
- **THEN** a finding for that subagent SHALL be reported, naming the prompt line as not allowed beside a `run`

#### Scenario: A run under a condition is still deterministic
- **GIVEN** a subagent holding only `if @variables.ready:` with a `run` beneath it
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported

### Requirement: A reasoning action offers an action to the model
A `reasoning.actions:` entry `<tool>: @actions.<name>` SHALL offer that action to the model under the name `<tool>`. Beneath it, `with <input> = ...` marks an input the model fills and `with <input> = <expression>` binds one; every declared input MUST appear exactly once. `set @variables.<v> = @outputs.<field>` clauses MAY follow. The subagent MUST also have a prompt line.

#### Scenario: An entry with model-filled inputs scans clean
- **GIVEN** `edit: @actions.edit_file` with `with path = ...` and `with content = ...`, in a subagent with a prompt line
- **WHEN** the document is scanned
- **THEN** no finding SHALL be reported for the entry

#### Scenario: An entry name of run is a syntax error
- **GIVEN** a reasoning-action entry named `run: @actions.run_command`
- **WHEN** the document is run
- **THEN** it SHALL be refused with `UnparsedDocumentError`, because `run` is a keyword of the dialect

#### Scenario: Reasoning actions without a prompt line are refused
- **GIVEN** a subagent whose only content is a `reasoning.actions` block
- **WHEN** the document is scanned
- **THEN** a finding for that subagent SHALL be reported

### Requirement: @actions names only the subagent's own actions
`@actions.<name>` SHALL be admitted only as a `run` target or as a reasoning-action entry's value, and `<name>` MUST be an action defined in the same subagent's `actions:` block. Anywhere else it SHALL be refused as `@actions`; an undefined name SHALL be refused naming it. Under a `run` or an entry, `@outputs.<field>` names that action's output.

#### Scenario: Calling another subagent's action is refused
- **GIVEN** subagent `check` running `@actions.edit_file`, which only subagent `act` defines
- **WHEN** the document is scanned
- **THEN** a finding naming `edit_file`, with where `subagent "check"`, SHALL be reported

#### Scenario: @actions in a condition is refused
- **GIVEN** `if @actions.run_checks:`
- **WHEN** the document is scanned
- **THEN** a finding with construct `@actions` SHALL be reported

## MODIFIED Requirements

### Requirement: The supported subset is declared once, as SUPPORTED_CONSTRUCTS
`@specsesh/agent/interpreter` SHALL declare the executable subset once: `SUPPORTED_CONSTRUCTS`, a plain array literal closed by `] as const;` in `src/interpreter/subset.ts`, with no second declaration in `src/`. Each entry SHALL be `{ id, summary, probe, kinds }`: a stable id, a summary, a probe that parses clean and produces every declared kind, and a non-empty list of node kinds. `SUPPORTED_CONSTRUCT_IDS` SHALL list the ids in order.

#### Scenario: The ten constructs, in order
- **WHEN** `SUPPORTED_CONSTRUCT_IDS` is read
- **THEN** its first ten entries SHALL equal `["config", "system.instructions", "variables", "variables.description", "subagent", "subagent.reasoning", "reasoning.prompt-line", "reasoning.interpolation", "reasoning.logic-line", "reasoning.structured-output"]`

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
  - `subagent.actions`: `["Collection<ActionBlock>", "ActionBlock", "InputsBlock", "OutputsBlock", "ParameterDeclaration"]`
  - `reasoning.run`: `["RunStatement", "WithClause", "SetClause", "MemberExpression", "AtIdentifier"]`
  - `reasoning.actions`: `["Collection<ReasoningActionBlock>", "ReasoningActionBlock", "WithClause", "Ellipsis"]`
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
  - `subagent.actions`: `actions a subagent defines, each bound to a host tool`
  - `reasoning.run`: `a run statement, calling an action deterministically`
  - `reasoning.actions`: `actions a reasoning step offers the model as tools`

#### Scenario: Probes exercise their constructs fully
- **WHEN** the probes are read
- **THEN** the `variables` probe SHALL declare a `mutable` string, a bare `name: type = value` parameter and a `mutable boolean = False`, so both `VariableDeclaration` and `ParameterDeclaration` are produced
- **AND** the `reasoning.interpolation` probe SHALL use `{!@variables.stage}` (with the `!`)
- **AND** the `reasoning.logic-line` probe SHALL contain `if not @variables.approved and @variables.count > 1:`, a prompt line, `else:` and `set @variables.stage = "specs"`
- **AND** the `reasoning.structured-output` probe SHALL contain `set @variables.verdict = @outputs.verdict` (plural `@outputs`)
- **AND** the `subagent.actions` probe SHALL define an action with `description`, `inputs`, `outputs` and `target: "mcpTool://run_checks"`
- **AND** the `reasoning.run` probe SHALL contain `run @actions.run_checks`, a `with` clause and `set @variables.checks_passed = @outputs.passed`
- **AND** the `reasoning.actions` probe SHALL contain an entry `edit: @actions.edit_file` with `with path = ...`

#### Scenario: Exactly one declaration exists
- **WHEN** every `.ts` file under the package's `src/`, read from disk, is searched for `(const|let|var) SUPPORTED_CONSTRUCTS (:|=)`
- **THEN** the only match SHALL be `src/interpreter/subset.ts`

#### Scenario: Three action constructs follow the ten
- **WHEN** `SUPPORTED_CONSTRUCT_IDS` is read
- **THEN** it SHALL have thirteen entries, the last three being `["subagent.actions", "reasoning.run", "reasoning.actions"]`

### Requirement: Supported block fields are named per block
`SUPPORTED_BLOCK_FIELDS` SHALL name the authored fields each supported block may carry, and the scan SHALL refuse any other field even when the block's node kind is supported. `agent_name` MUST stay allowed, because the Agentforce dialect requires `agent_name` or `developer_name`. Nothing in the runtime reads a `config` value. A subagent and its reasoning block MAY each carry `actions`.

#### Scenario: The field table
- **WHEN** `SUPPORTED_BLOCK_FIELDS` is read
- **THEN** it SHALL be exactly:
  - `Document` (the dialect's root object, not a node kind): `config`, `system`, `variables`, `subagent`
  - `ConfigBlock`: `agent_name`, `developer_name`, `agent_type`, `description`
  - `SystemBlock`: `instructions`
  - `VariableDeclaration` and `ParameterDeclaration`: `properties` (the dialect files a variable's `description:` under this synthetic field)
  - `VariablePropertiesBlock`: `description`
  - `SubagentBlock`: `description`, `reasoning`, `actions`
  - `ReasoningBlock`: `instructions`, `actions`
  - `ActionBlock`: `description`, `inputs`, `outputs`, `target`

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
- **GIVEN** a subagent `t` with a field other than `description`, `reasoning` or `actions`
- **WHEN** the document is scanned
- **THEN** a finding naming that field, with where `subagent "t"`, SHALL be reported

### Requirement: Statements, expressions and defaults are limited to declared kinds
The scan SHALL admit statements only of `SUPPORTED_STATEMENT_KINDS`, expressions only of `SUPPORTED_EXPRESSION_KINDS`, defaults only of `SUPPORTED_DEFAULT_VALUE_KINDS` (exactly the literal kinds the declaration reader reads), `reasoning.instructions` only as a `ProcedureValue`, and template parts only as `TemplateText` or `TemplateInterpolation`, whose expression is scanned as a read. `Identifier` SHALL NOT be an expression kind.

#### Scenario: The kind lists
- **WHEN** the lists are read
- **THEN** `SUPPORTED_STATEMENT_KINDS` SHALL be `["Template", "IfStatement", "SetClause", "RunStatement"]`
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
