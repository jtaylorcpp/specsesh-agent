# core/composition Specification

## Purpose
How a subagent's instructions become one reasoning step: declared variables as the run's state, prompt lines composed into text, logic lines evaluated by the program and never by a model, and variables written only from a structured result.

## Requirements

### Requirement: Declared variables are the run's initial state
The interpreter SHALL take every variable in the document's `variables:` block, in source order, as the run's initial state, starting each at its authored literal default with no separate seeding step. A string default starts as its string, a number as `Number(value)`, and `True` / `False` as `true` / `false`.

#### Scenario: An authored value is the starting value
- **GIVEN** a document declaring `stage: mutable string = "proposal"`
- **WHEN** it is run with no starting overrides
- **THEN** a prompt line interpolating `{!@variables.stage}` SHALL contain `proposal`
- **AND** the result's `variables.stage` SHALL be `"proposal"` if nothing sets it

#### Scenario: Each literal kind starts as its JavaScript value
- **GIVEN** `name: mutable string = "World"`, `count: mutable number = 3` and `approved: mutable boolean = False`
- **WHEN** the document is run and no line sets them
- **THEN** the result's `variables` SHALL be `{ name: "World", count: 3, approved: false }`

#### Scenario: A starting override replaces an authored value
- **GIVEN** `approved: mutable boolean = False`
- **WHEN** the document is run with `variables: { approved: true }`
- **THEN** every logic line SHALL read `approved` as `true` from the first step

### Requirement: Both declaration forms are read the same way
The interpreter SHALL read a `VariableDeclaration` (`name: mutable <type> = <value>`) and a `ParameterDeclaration` (`name: <type> = <value>`) identically. A variable's `description:` SHALL affect neither its value nor its type.

#### Scenario: Both declaration forms seed state
- **GIVEN** `stage: mutable string = "proposal"` and `change_id: string = "OS-1"`
- **WHEN** the document is run
- **THEN** both `stage` and `change_id` SHALL appear in the result's `variables` with their authored values

#### Scenario: A description changes nothing
- **GIVEN** `name: mutable string = "World"` with `description: "who to greet"` beneath it
- **WHEN** the document is run
- **THEN** `variables.name` SHALL start as `"World"`

### Requirement: A declared variable records its type and value span
Each `DeclaredVariable` SHALL have exactly `name`, `type`, `initial` and `valueRange`. `type` SHALL be read off the declaration's type `Identifier`, falling back to `"string"` when none can be read. `valueRange` SHALL be the source range of the authored default. `VariableValue` SHALL be `string | number | boolean`.

#### Scenario: Type drives the result schema
- **GIVEN** `count: mutable integer = 0` written from `@outputs.n`
- **WHEN** the step is composed
- **THEN** the schema property `n` SHALL be `{ type: "number" }`, showing the type was read as `integer`

### Requirement: An unreadable default is a contradiction, not a skipped variable
Reading a declaration whose default is not a string, number or boolean literal SHALL throw `UnreadableDefaultError` rather than skip the variable. Its `name` SHALL be `"UnreadableDefaultError"` and its message SHALL name `@variables.<name>`, the default's kind (or `(unparsed)`) and `SUPPORTED_DEFAULT_VALUE_KINDS`.

#### Scenario: A non-literal default never reaches the reader through a run
- **GIVEN** a document declaring `b: mutable string = @variables.a`
- **WHEN** it is run
- **THEN** the subset scan SHALL refuse it with `UnsupportedConstructError` before declarations are read
- **AND** no `UndeclaredVariableError` naming `b` SHALL be raised

### Requirement: System instructions travel as their own channel
The interpreter SHALL render the document-level `system.instructions` once as every request's `systemInstructions`, and SHALL never put them in the prompt. A document with no `system:` block SHALL produce `systemInstructions` of `""`.

#### Scenario: System instructions travel beside the prompt, not inside it
- **GIVEN** `system.instructions` of `You help the author.` and a first subagent with `| Read the artifact.`
- **WHEN** the document is run
- **THEN** the request's `systemInstructions` SHALL contain `You help the author.`
- **AND** its `prompt` SHALL NOT contain it

#### Scenario: No system block
- **GIVEN** a document with no `system:` block
- **WHEN** it is run
- **THEN** every request's `systemInstructions` SHALL be `""`

#### Scenario: Every step carries the same instructions
- **WHEN** a run dispatches two steps
- **THEN** both requests SHALL carry identical `systemInstructions`

### Requirement: System instructions are not composed against run state
A `{!@variables.x}` interpolation inside `system.instructions` SHALL render as the literal source text `{!@variables.x}`, never as the variable's value and never as an empty string.

#### Scenario: An interpolation in the system block is not filled in
- **GIVEN** `system.instructions` containing `{!@variables.stage}` and `stage: mutable string = "proposal"`
- **WHEN** the document is run
- **THEN** `systemInstructions` SHALL contain the literal text `{!@variables.stage}`
- **AND** SHALL NOT contain `proposal` in its place

### Requirement: Prompt lines compose in source order
The interpreter SHALL compose a step's prompt from the prompt lines (`| …`) its `reasoning.instructions: ->` procedure reaches, in source order, joined by a single `"\n"` with no other separator, prefix or suffix. A subagent with no `reasoning` block or no statements SHALL compose an empty prompt.

#### Scenario: Prompt lines compose in order
- **GIVEN** a subagent with `| Read the artifact.` then `| Draft the summary.`
- **WHEN** it is run
- **THEN** the dispatched prompt SHALL be `Read the artifact.\nDraft the summary.`

### Requirement: An unreached prompt line leaves no trace
A prompt line inside an `if` branch that is not taken SHALL be absent from the prompt, leaving no blank line in its place.

#### Scenario: A conditional prompt line is absent when its condition does not hold
- **GIVEN** `if @variables.approved:` holding `| Publish it.`, an unconditional `| Summarise it.`, and `approved` false
- **WHEN** it is run
- **THEN** the prompt SHALL be `Summarise it.`

#### Scenario: The else branch supplies the prompt line
- **GIVEN** the hello-world `sign_off` subagent, with an enthusiastic line under `if @variables.excited:` and a calm one under `else:`
- **WHEN** it runs with `excited` false
- **THEN** the prompt SHALL be the calm line only

### Requirement: Interpolation is read from the parse
The interpreter SHALL substitute a value only where the dialect parsed a `TemplateInterpolation` reading `@variables.<name>`, rendering every other template part as its literal text, so a brace the author typed (including the rejected spelling `{@variables.x}`) stays as written. The value SHALL render as `String(value)`.

#### Scenario: A variable is interpolated
- **GIVEN** `name: mutable string = "World"` and `| Write a one-line greeting for {!@variables.name}.`
- **WHEN** it is run
- **THEN** the prompt SHALL be `Write a one-line greeting for World.`

#### Scenario: Numbers and booleans render in JavaScript's spelling
- **GIVEN** `count` is `3` and `approved` is `false`, interpolated into one prompt line
- **WHEN** it is composed
- **THEN** the line SHALL contain `3` and `false`

### Requirement: An interpolation reads the value at the moment it is reached
An interpolation SHALL read the variable's current value when its line is reached, including a value set by an earlier logic line in the same step.

#### Scenario: A later prompt line sees an earlier set
- **GIVEN** `stage` declared `"proposal"`, then `set @variables.stage = "specs"`, then `| Draft the {!@variables.stage}.`
- **WHEN** it is run
- **THEN** the prompt SHALL be `Draft the specs.`

### Requirement: Logic lines are decided by the program, never the model
The interpreter SHALL evaluate logic lines (`if` / `else`, `set @variables.x = <expression>`) itself, deterministically, while composing the step, and SHALL decide every reached `run` statement the same way. Composition SHALL take no port, so no logic line or `run` can cause a request; a reached `run` yields an action call to the host instead (`core/step-machine`).

#### Scenario: Logic never consults the model
- **GIVEN** a document whose only subagent is `if @variables.name == "World":` holding `set @variables.excited = True`
- **WHEN** it is run with a recording port
- **THEN** the port SHALL receive zero requests
- **AND** the result SHALL be `completed` with `variables.excited` `true`

#### Scenario: A boolean literal in a comparison is evaluated as a value
- **GIVEN** a logic-only subagent setting `stage` to `"blocked"` when `@variables.approved == False`, else `"specs"`
- **WHEN** it runs with `approved` false, and again with `variables: { approved: true }`
- **THEN** `stage` SHALL be `"blocked"` then `"specs"`
- **AND** neither run SHALL dispatch a request

#### Scenario: A run statement makes no request
- **GIVEN** a deterministic subagent holding only `run @actions.run_checks` with its `with` and `set` clauses
- **WHEN** it is run with a recording port and a host that answers the call
- **THEN** the port SHALL receive zero requests
- **AND** exactly one action call SHALL reach the host

### Requirement: Statements run top to bottom and branch on truthiness
Statements SHALL run in source order, and a `set` SHALL take effect immediately, so later statements in the step read the new value. An `if` SHALL walk only its body when the condition is truthy, otherwise its `else:` block if any. A nested `if` MUST NOT run: the dialect reports it as an error, so the run is refused before anything is dispatched.

#### Scenario: A set feeds a later condition
- **GIVEN** `set @variables.count = 2` followed by `if @variables.count > 1:` holding `| Many.`
- **WHEN** it is composed
- **THEN** the prompt SHALL be `Many.`

#### Scenario: A nested if is refused before running
- **GIVEN** `if @variables.a:` containing `if @variables.b:` holding `| Both.`
- **WHEN** it is run
- **THEN** it SHALL reject with `UnparsedDocumentError` whose diagnostics include the dialect's `does not support nested 'if' statements`
- **AND** the port SHALL receive zero requests

### Requirement: Literals and references evaluate to their values
A `StringLiteral` SHALL evaluate to its string, a `NumberLiteral` to `Number(value)`, a `BooleanLiteral` to `true` exactly when written `True`, and `@variables.x` to x's current value. Any other expression kind SHALL evaluate to `""`; the subset scan refuses such kinds before a run starts.

#### Scenario: A set copies one variable into another
- **GIVEN** `a: mutable string = "x"`, `b: mutable string = ""` and `set @variables.b = @variables.a`
- **WHEN** it is run
- **THEN** `variables.b` SHALL be `"x"`

### Requirement: not, and and or combine truthiness
`not e` SHALL be the negation of e's truthiness. `a and b` SHALL be `truthy(a) && truthy(b)`, always evaluating both sides. `a or b` SHALL be `truthy(a) || truthy(b)`, evaluating `b` only when `a` is falsy. Each result is a boolean that `set` MAY store.

#### Scenario: and, or and not combine conditions
- **GIVEN** `approved` false and `count` 2
- **WHEN** `not @variables.approved and @variables.count > 1` is evaluated
- **THEN** it SHALL be true and the body SHALL be taken

#### Scenario: or takes either side
- **GIVEN** `a` false and `b` true
- **WHEN** `@variables.a or @variables.b` is evaluated
- **THEN** it SHALL be true

### Requirement: Comparisons are strict
`==` SHALL be JavaScript `===` and `!=` SHALL be `!==`, with no coercion, so `1 == "1"` is false. `<`, `<=`, `>` and `>=` SHALL be JavaScript's relational operators on the evaluated values, including JavaScript's rules for mixed types. A comparison's result is a boolean that `set` MAY store.

#### Scenario: Strict equality does not coerce
- **GIVEN** `count: mutable number = 1` and `if @variables.count == "1":` holding `set @variables.stage = "matched"`
- **WHEN** it is run
- **THEN** `stage` SHALL keep its authored value

#### Scenario: A set stores a computed boolean
- **GIVEN** `count: mutable number = 5`, `big: mutable boolean = False` and `set @variables.big = @variables.count > 3`
- **WHEN** it is run
- **THEN** `variables.big` SHALL be `true`

### Requirement: Truthiness is stated once
A boolean SHALL be truthy when it is `true`. A number SHALL be truthy exactly when it is not `0`, so `NaN` is truthy. A string SHALL be truthy exactly when it is non-empty, so `"False"`, `"0"` and `" "` are truthy.

#### Scenario: Truthiness per type
- **WHEN** a condition reads `0`, `""`, `false`, `1`, `"x"` or `true`
- **THEN** it SHALL be falsy for `0`, `""` and `false`, and truthy for the others

#### Scenario: A non-empty string that says False is truthy
- **GIVEN** `flag: mutable string = "False"` and `if @variables.flag:` holding `set @variables.stage = "taken"`
- **WHEN** it is run
- **THEN** `stage` SHALL be `"taken"`

### Requirement: Every undeclared reference is refused before anything runs
A document that mentions `@variables.<name>` anywhere without declaring it SHALL be refused before any request or variable change, and the reference SHALL NOT be resolved to `""`, `0` or `false`. The dialect's lint reports it first, as the error `'<name>' is not defined in variables`, so `run` and `start` reject with `UnparsedDocumentError`. This covers every subagent, entered or not, and both branches of every `if`.

#### Scenario: An undeclared variable is refused by name
- **GIVEN** a prompt line interpolating `{!@variables.missing}` and no `missing` declared
- **WHEN** it is run
- **THEN** it SHALL reject with `UnparsedDocumentError` whose message contains `'missing' is not defined in variables`
- **AND** the port SHALL receive zero requests

#### Scenario: An undeclared reference on a branch nobody takes
- **GIVEN** an `else:` branch, never taken, that sets `@variables.ghost`
- **WHEN** it is run
- **THEN** it SHALL reject with `UnparsedDocumentError` naming `ghost` before any request

#### Scenario: An undeclared reference in a subagent the run never enters
- **GIVEN** a second subagent reading `@variables.ghost` and `entry` naming only the first
- **WHEN** it is run
- **THEN** it SHALL reject with `UnparsedDocumentError` naming `ghost`

### Requirement: The undeclared check covers every reading and writing position
The refusal SHALL cover interpolations in prompt lines, every `@variables` read in a condition (both sides of `and`, `or` and comparisons, and the operand of `not`), every `set` target, and every `@variables` read in a `set` value. The interpreter keeps its own whole-document check behind the lint, which raises `UndeclaredVariableError` for the first undeclared reference in source order if the lint ever stops reporting one.

#### Scenario: An undeclared set target
- **GIVEN** `set @variables.nowhere = "x"` with no `nowhere` declared
- **WHEN** it is run
- **THEN** it SHALL reject with `UnparsedDocumentError` naming `nowhere`

#### Scenario: An undeclared read on the right of or
- **GIVEN** `if @variables.ok or @variables.ghost:` with `ok` declared true and `ghost` undeclared
- **WHEN** it is run
- **THEN** it SHALL reject with `UnparsedDocumentError` naming `ghost`, even though `or` would not evaluate it

### Requirement: An undeclared reference error names the reference and its position
Each undeclared reference SHALL be reported at its own position, not the position of the line holding it. The interpreter's `UndeclaredVariableError` SHALL have `name` `"UndeclaredVariableError"`, expose `variable` and `range`, and carry a message containing `@variables.<name>`, the 1-based `line:character` and `declares no such variable`.

#### Scenario: Each reference reports its own position
- **GIVEN** `| {!@variables.stage} then {!@variables.bad}.` with `stage` declared and `bad` not
- **WHEN** it is run
- **THEN** the refusal's diagnostic for `bad` SHALL start at `{!@variables.bad}`, not at the start of the line

### Requirement: Assignments from the structured result wait for the answer
`set @variables.<x> = @outputs.<f>` SHALL be recorded as a pending assignment `{ variable: "<x>", field: "<f>" }`, in source order, and SHALL NOT change `<x>` while composing. One on an untaken branch SHALL NOT be recorded. `PendingAssignment` SHALL have exactly `variable` and `field`.

#### Scenario: A step that writes a variable asks for a structured result
- **GIVEN** the hello-world `greet` subagent: `| Write a one-line greeting for {!@variables.name}.` then `set @variables.greeting = @outputs.greeting`
- **WHEN** it is composed
- **THEN** the request SHALL carry an `outputSchema`
- **AND** `greeting` SHALL be unchanged until the answer is applied

#### Scenario: A pending set on an untaken branch asks for nothing
- **GIVEN** a prompt line and `if @variables.approved:` holding `set @variables.verdict = @outputs.verdict`, with `approved` false
- **WHEN** it is composed
- **THEN** the request SHALL carry no `outputSchema`

### Requirement: The result schema is derived from the pending assignments
A step with pending assignments SHALL carry `outputSchema` equal to `{ type: "object", properties, required, additionalProperties: false }`. `properties` holds one `{ type }` per field: `"number"` for a variable declared `number` or `integer`, `"boolean"` for `boolean`, else `"string"`; a field writing a variable the run's `choices` constrain also carries `enum`, those values in order. `required` lists every field once, in first-seen order. A text-only step SHALL carry no `outputSchema` key.

#### Scenario: Schema for a string and a boolean field
- **GIVEN** `verdict: mutable string = ""`, `approved: mutable boolean = False`, `set @variables.verdict = @outputs.verdict` and `set @variables.approved = @outputs.ok`
- **WHEN** the step is composed
- **THEN** `outputSchema` SHALL equal `{ type: "object", properties: { verdict: { type: "string" }, ok: { type: "boolean" } }, required: ["verdict", "ok"], additionalProperties: false }`

#### Scenario: One field feeding two variables is required once
- **GIVEN** `set @variables.a = @outputs.v` and `set @variables.b = @outputs.v`
- **WHEN** the step is composed
- **THEN** `required` SHALL be `["v"]`
- **AND** `properties.v.type` SHALL come from the type of `b`, the later assignment

#### Scenario: A text-only step carries no schema
- **GIVEN** prompt lines and no `@outputs` assignment
- **WHEN** the step is composed
- **THEN** the request SHALL have no `outputSchema` key

#### Scenario: A chosen variable's field carries its values
- **GIVEN** `next_action: mutable string = "retry"`, `set @variables.next_action = @outputs.next_action`, and a run started with `choices: { next_action: ["retry", "amend-spec", "ask"] }`
- **WHEN** the step is composed
- **THEN** `properties.next_action` SHALL equal `{ type: "string", enum: ["retry", "amend-spec", "ask"] }`

### Requirement: Only the structured result writes a variable from the model
When a step with pending assignments answers, variables SHALL be set only from the outcome's `structured` object, never from its text. Values SHALL be taken as given, with no coercion to the declared type. Extra fields SHALL be ignored, and a step with no pending assignments SHALL ignore any `structured` it receives. Action outputs SHALL come from the host's results, never from the model's text or arguments.

#### Scenario: A structured update applies only that result
- **GIVEN** `set @variables.verdict = @outputs.verdict`
- **WHEN** the port answers `{ kind: "answered", text: "verdict: rejected", structured: { verdict: "approved" } }`
- **THEN** `variables.verdict` SHALL be `"approved"`

#### Scenario: Prose is not parsed for state
- **GIVEN** `set @variables.verdict = @outputs.verdict`
- **WHEN** the port answers text `{"verdict":"approved"}` with no `structured`
- **THEN** `verdict` SHALL NOT be set from that text

#### Scenario: A tool call's arguments are not its outputs
- **GIVEN** a reasoning-action entry `edit: @actions.edit_file` with `set @variables.edited = @outputs.ok`
- **WHEN** the step answers with a successful tool call whose inputs include `ok: true` and whose host outputs are `{ ok: false }`
- **THEN** `variables.edited` SHALL be `false`

### Requirement: A missing structured result is a failure that sets nothing
When a step with pending assignments answers with `structured` missing, `null`, an array or not an object, the step SHALL settle as `failed` with category `unknown`, a message naming the requested fields and containing `received none`, and no variable set.

#### Scenario: No structured result
- **GIVEN** a step with a pending assignment
- **WHEN** the port answers `{ kind: "answered", text: "approved" }`
- **THEN** the step and the run SHALL end `failed` with category `unknown`
- **AND** the variable SHALL keep its previous value

### Requirement: A partial or malformed result sets nothing
When any pending field is absent from `structured`, or is not a string, number or boolean, the step SHALL settle as `failed` with category `unknown` and a message naming the field and `@variables.<x>` and containing `No variable was set`. No variable SHALL be set, including fields that were valid.

#### Scenario: A partial result leaves no variable half-written
- **GIVEN** pending assignments for fields `a`, `b` and `c`
- **WHEN** `structured` carries `a` and `b` but not `c`
- **THEN** the step SHALL fail and none of the three variables SHALL change

#### Scenario: A value of the wrong JSON shape is refused
- **WHEN** a pending field's value is `null` or `{}`
- **THEN** the step SHALL fail with a message naming that field, and set nothing

### Requirement: A run does not edit the script unless asked
The interpreter SHALL do no file I/O, and `run` SHALL return no `updatedSource` unless `persistVariables: true` is passed. With it, the result SHALL carry `updatedSource`, the source text with authored defaults replaced by the run's final values, for a completed, failed or cut-short run alike. It is returned as text and never written anywhere.

#### Scenario: A run does not edit the script
- **WHEN** a source is run without `persistVariables` through steps that change variables
- **THEN** the result SHALL have no `updatedSource`
- **AND** the caller's source string SHALL be unchanged

#### Scenario: Nothing changed means identical text
- **WHEN** a run with `persistVariables: true` ends with every variable at its authored value
- **THEN** `updatedSource` SHALL equal the input source

### Requirement: Persistence rewrites only changed values, in the dialect's spelling
Only variables whose final value is `!==` their authored default SHALL be rewritten, each by splicing exactly the default's source span, applied back to front so every other byte survives. Strings SHALL be written as `JSON.stringify(value)`, numbers as `String(value)`, and booleans as `True` / `False` (from `BOOLEAN_LITERALS`).

#### Scenario: Persistence writes the dialect's spelling, so a saved run still lints clean
- **GIVEN** `approved: mutable boolean = False` and a run that sets it to `true`
- **WHEN** it is run with `persistVariables: true`
- **THEN** `updatedSource` SHALL contain `approved: mutable boolean = True`
- **AND** analysing `updatedSource` SHALL report no error-severity diagnostic

#### Scenario: Only the value span changes
- **GIVEN** `stage: mutable string = "proposal"` with a description line and a comment beside it
- **WHEN** a run sets `stage` to `say "hi"` and persists
- **THEN** `updatedSource` SHALL differ from the source only in that default, now `"say \"hi\""`

### Requirement: Run inputs are evaluated when the run is reached
Each `with <input> = <expression>` of a `run` SHALL be evaluated against the working variables at the moment the walk reaches that `run`, so it reads every earlier `set`. A value whose type is not the input's declared type SHALL stop the run as a failed action naming the input, before the host is called.

#### Scenario: An input reads an earlier set
- **GIVEN** `set @variables.task_id = "2.4"` followed by `run @actions.run_checks` with `with task_id = @variables.task_id`
- **WHEN** the call is produced
- **THEN** its `inputs` SHALL be `{ task_id: "2.4" }`

#### Scenario: A wrongly typed input never reaches the host
- **GIVEN** an input declared `number`, given `with count = @variables.label` where `label` is a string
- **WHEN** the walk reaches the `run`
- **THEN** the run SHALL stop failed, naming `count`, and no call SHALL reach the host

### Requirement: Run outputs are applied together
When an action call succeeds, each `set @variables.<v> = @outputs.<field>` beneath its `run` SHALL take `outputs[field]`, all staged first and then applied together; statements after the `run` read the new values. An output field that is missing, or not a string, number or boolean, SHALL fail the action and set nothing from it.

#### Scenario: Two outputs land together
- **GIVEN** `set @variables.checks_passed = @outputs.passed` and `set @variables.check_output = @outputs.output` under a `run`
- **WHEN** the host answers `{ ok: true, outputs: { passed: true, output: "12 passed" } }`
- **THEN** both variables SHALL be set

#### Scenario: A missing output field sets nothing
- **WHEN** the host answers `{ ok: true, outputs: { passed: true } }` for the same `run`
- **THEN** the action SHALL fail, naming `output`, and `checks_passed` SHALL keep its earlier value

### Requirement: A reasoning action becomes a tool offer
Each reasoning-action entry SHALL become one `ToolOffer` on the step's request, in source order: `name` the entry's key, `description` the action's description, `action` the target's tool name, `inputSchema` a JSON Schema object of the model-filled inputs (each typed as declared, all required, `additionalProperties: false`), and `bound` the bound inputs, evaluated when the step is composed.

#### Scenario: Model-filled and bound inputs are split
- **GIVEN** `shell: @actions.run_command` with `with command = ...`, and `note: @actions.edit_file` with `with path = "NOTES.md"` and `with content = ...`
- **WHEN** the step is composed
- **THEN** `tools` SHALL hold `shell` with `inputSchema.properties` `{ command: { type: "string" } }` and `bound` `{}`
- **AND** `note` with `inputSchema.required` `["content"]` and `bound` `{ path: "NOTES.md" }`

### Requirement: A reasoning action's set takes the last successful call's outputs
After a step answers, each `set … = @outputs.<field>` under a reasoning-action entry SHALL take the field from the outputs of the last recorded call to that entry's tool with `ok` true, staged and applied together with the structured result. A tool never called, or with no successful call, SHALL set nothing and is not a failure. A successful call whose outputs lack the field SHALL make the step failed, setting nothing.

#### Scenario: The last successful call wins
- **GIVEN** an entry `shell` with `set @variables.last_exit = @outputs.exit_code`
- **WHEN** the model calls `shell` twice, both successful, with outputs `exit_code` `1` then `0`
- **THEN** `last_exit` SHALL be `0`

#### Scenario: A refused call after a successful one is skipped
- **WHEN** the model calls `shell` successfully with `exit_code` `1`, then calls it again and the call is refused (`ok` false, outputs `{}`)
- **THEN** `last_exit` SHALL be `1` and the step SHALL be answered, not failed

#### Scenario: A tool never called sets nothing
- **WHEN** the step answers without calling `shell`, or with only refused calls to it
- **THEN** `last_exit` SHALL keep its value and the step SHALL be answered, not failed

### Requirement: A host constrains string variables with choices
`StartOptions.choices`, when given, SHALL map variable names to non-empty string arrays. After the undeclared check, `start` SHALL throw `InvalidChoicesError` for a choice whose variable is undeclared or not declared `string`, whose list is empty, or which excludes the variable's opening value; the message names the variable and the reason. Choices constrain only values taken from a structured result.

#### Scenario: A choice on an undeclared variable is refused
- **WHEN** `start` is called with `choices: { nope: ["a"] }` on a document that does not declare `nope`
- **THEN** it SHALL throw `InvalidChoicesError` naming `nope`

#### Scenario: A choice on a boolean is refused
- **WHEN** `start` is called with `choices: { met: ["yes"] }` where `met` is declared `boolean`
- **THEN** it SHALL throw `InvalidChoicesError` naming `met` and saying it is not a string

#### Scenario: Choices must include the opening value
- **GIVEN** `next_action: mutable string = "retry"`
- **WHEN** `start` is called with `choices: { next_action: ["ask"] }`
- **THEN** it SHALL throw `InvalidChoicesError` naming `next_action` and `"retry"`

#### Scenario: An empty choice list is refused
- **WHEN** `start` is called with `choices: { next_action: [] }`
- **THEN** it SHALL throw `InvalidChoicesError` naming `next_action`

### Requirement: A result outside a variable's choices sets nothing
When a pending field writes a chosen variable and its value is not one of the choices, the step SHALL settle `failed` with category `unknown` and a message naming the field, `@variables.<x>` and every choice, and containing `No variable was set`. No variable SHALL be set, including fields that were valid.

#### Scenario: Prose in a chosen field fails the step
- **GIVEN** a judge step writing `met` and `next_action`, with `next_action` constrained to `retry`, `amend-spec` and `ask`
- **WHEN** `structured` is `{ met: false, next_action: "retry. Both questions can be settled" }`
- **THEN** the step SHALL fail naming `next_action` and the three choices
- **AND** neither `met` nor `next_action` SHALL change
