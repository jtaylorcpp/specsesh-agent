## REMOVED Requirements

### Requirement: submit_result takes any object and validates it itself
**Reason**: A permissive parameter schema let a provider that constrains output to the tool's schema (`claude --json-schema`) return untyped values, which were then refused forever.
**Migration**: See "The result tool's parameters are the step's schema".

## ADDED Requirements

### Requirement: The result tool's parameters are the step's schema
On a structured step, the offered `submit_result` SHALL have `parameters` equal to the request's `outputSchema`, `replay: "safe"` and the description `Submit this step's result as an object with exactly the fields the system prompt lists. Call it once; it ends the step.` Every call MUST reach the tool, which checks the arguments as sent (bypassing pi's validation and coercion) with `checkResult` against the doc's `schema`.

#### Scenario: The provider sees the step's types
- **GIVEN** a judge step whose schema wants `met` as a boolean
- **WHEN** its conversation is dispatched
- **THEN** the offered `submit_result` tool's `parameters` SHALL be that schema, with `met` of type `boolean`

#### Scenario: A wrongly typed field still reaches the tool's own check
- **WHEN** a provider ignores the parameters and calls `submit_result` with `{ severity: 3 }` on a step whose schema wants a string
- **THEN** pi SHALL execute the tool, and the tool SHALL produce the refusal

#### Scenario: A call pi's own validation would refuse is the tool's refusal
- **WHEN** the model calls `submit_result` on the judge step with `{}`, then with `met: "yes"`
- **THEN** each SHALL come back as the tool's refusal text, not pi's validation error, and `refusals` SHALL be `2`

### Requirement: Refused results are bounded per step
The `agentscript.step` doc SHALL count refused `submit_result` calls in `refusals`, starting at `0`. The third refusal in one step MUST end the step: the step settles `{ kind: "failed", category: "unknown" }` with a message naming the count and the last problem, and no further model request is made for it.

#### Scenario: A model that never fixes its result stops after three tries
- **GIVEN** a provider that answers every judge request with `submit_result` `{ met: "true", unmet: "", next_action: "proceed", question: "done" }`
- **WHEN** the step runs
- **THEN** the provider SHALL have been asked exactly 3 times
- **AND** the step SHALL be failed, category `unknown`, with a message containing `refused 3 times` and `"met" must be a boolean`

## MODIFIED Requirements

### Requirement: The agentscript.step doc holds each step's schema and accepted result
`@specsesh/agent/durable` SHALL export `AgentScriptStep`, defined with `defineDoc` as kind `agentscript.step`, version `1`, scope `conversation`, history `latest`, fork `initial`, and initial value `{ schema: null, result: null, refusals: 0 }`. `schema` MUST be the step's JSON Schema or `null` for a text-only step; `result` MUST be `null` until `submit_result` accepts a result, and then the accepted object.

#### Scenario: A fresh step conversation starts empty and gets its schema at dispatch
- **WHEN** dispatch configures a structured step
- **THEN** the doc SHALL read `{ schema: <the request's outputSchema>, result: null, refusals: 0 }` before the model is called

#### Scenario: A text-only step's doc has no schema
- **WHEN** dispatch configures a text-only step
- **THEN** the doc SHALL read `{ schema: null, result: null, refusals: 0 }`

### Requirement: submit_result records an accepted result or hands the problem back
On each call `submit_result` SHALL read the conversation's `agentscript.step` doc and call `checkResult(doc.schema, args)`:
- a problem string → return that text with `isError: true`, write only the incremented `refusals`, and leave the step running for another call, unless it was the third refusal;
- no problem → commit `doc.result = args` and return the text `Result recorded.` with `control: { terminate: true }`, ending the step's turn.

#### Scenario: A bad result is handed back and the model retries within the same step
- **GIVEN** the `classify` step and a model that first calls `submit_result` with `{ severity: 3 }`, then with `{ severity: "high" }`
- **WHEN** the run completes
- **THEN** the second model request SHALL contain the error text `"severity" must be a string, got number`
- **AND** `result.variables.severity` SHALL be `"high"`
- **AND** the run SHALL have made exactly three model requests in total (two for `classify`, one for `respond`)

#### Scenario: An accepted result ends the step
- **WHEN** the model calls `submit_result` with a result that passes `checkResult`
- **THEN** the tool SHALL return `Result recorded.` with `control.terminate` true
- **AND** the step doc's `result` SHALL equal the submitted arguments
