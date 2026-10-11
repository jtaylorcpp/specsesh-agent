## MODIFIED Requirements

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

## ADDED Requirements

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
