## MODIFIED Requirements

### Requirement: Length, abort and error stops are failures with a structured category
`toOutcome(message, wantsStructured, status?)` SHALL map `length` to `failed` / `max_output_tokens`, message defaulting to `the model hit its output token limit`; `aborted` to `failed` / `unrecognised` (via `toFailureCategory("aborted")`), message defaulting to `the request was aborted`; and every other `stopReason` to `failed` with the category `categoryFromStatus` gives the first diagnostic `error.code`, else `status`. The message MUST be `errorMessage` when present.

#### Scenario: A length stop is never answered
- **WHEN** a message with `stopReason` `length` is mapped
- **THEN** the outcome SHALL be `failed` with category `max_output_tokens`

#### Scenario: An abort is unrecognised with its message kept
- **WHEN** a message with `stopReason` `aborted` and `errorMessage` `user cancelled` is mapped
- **THEN** the outcome SHALL be `{ kind: "failed", category: "unrecognised", message: "user cancelled" }`

#### Scenario: The category comes from the status, not the message
- **GIVEN** an error message whose text says `rate limit` and whose diagnostic code is `402`
- **WHEN** it is mapped
- **THEN** the category SHALL be `billing_error`

#### Scenario: No status means unknown
- **WHEN** an error message with no diagnostic code is mapped with no status
- **THEN** the category SHALL be `unknown`

#### Scenario: An error with no message names its stop reason
- **WHEN** a message with `stopReason` `error` and no `errorMessage` is mapped
- **THEN** the message SHALL be `the request ended with stopReason "error"`

#### Scenario: A given status maps when diagnostics carry none
- **WHEN** an error message with no diagnostic code is mapped with status `429`
- **THEN** the category SHALL be `rate_limit`

#### Scenario: The diagnostic code wins over the given status
- **WHEN** an error message whose diagnostic code is `402` is mapped with status `429`
- **THEN** the category SHALL be `billing_error`

## ADDED Requirements

### Requirement: The port records each response's HTTP status
For every model request, the port SHALL pass pi a `fetch` that calls `globalThis.fetch` and keeps the status of the response, and SHALL map the message with that status. This covers a one-shot step, every tool-loop round and the settling request, streamed or not. On `google-generative-ai` and `google-vertex` models the port MUST pass no `fetch`.

#### Scenario: A 429 on the Anthropic wire is a rate limit
- **GIVEN** an `anthropic` model pointed at a server answering `429`
- **WHEN** a step runs through the port
- **THEN** it SHALL fail with category `rate_limit`

#### Scenario: A 401 on the OpenAI wire is an authentication failure
- **GIVEN** an `openai` model pointed at a server answering `401`
- **WHEN** a step runs through the port
- **THEN** it SHALL fail with category `authentication_failed`

#### Scenario: A 500 from Ollama is a server error
- **GIVEN** an `ollamaProvider` model pointed at a server answering `500`
- **WHEN** a step runs through the port
- **THEN** it SHALL fail with category `server_error`

#### Scenario: A tool-loop round keeps its status
- **GIVEN** a port with a tool host, and a server answering `429`
- **WHEN** a step offering a tool runs
- **THEN** it SHALL fail with category `rate_limit`

#### Scenario: A streamed step keeps its status
- **GIVEN** a server answering `429`
- **WHEN** a step runs through the port with a stream
- **THEN** it SHALL fail with category `rate_limit`
