## MODIFIED Requirements

### Requirement: maxRounds bounds a step's model requests
`maxRounds` SHALL default to `16` and count every model request a step makes, the settling request included. A step that reaches it while the model still calls tools SHALL end `{ kind: "cut-short", text, turns: maxRounds, toolCalls }`. A reply whose `stopReason` is `length`, `aborted` or `error` SHALL end the step with `toOutcome`'s failure plus the step's `toolCalls`. `onMessage` SHALL see every reply.

#### Scenario: A model that never stops calling tools is cut short
- **GIVEN** a port with `maxRounds: 3` and a model that calls a tool on every reply
- **WHEN** the step runs
- **THEN** exactly 3 requests SHALL be made and the outcome SHALL be `cut-short` with `turns` `3` and three `toolCalls`

#### Scenario: An error reply mid-loop fails the step
- **WHEN** the model's second reply has `stopReason` `error` and diagnostic code `429`
- **THEN** the outcome SHALL be `failed` with category `rate_limit`
- **AND** its `toolCalls` SHALL hold the call the first reply made
