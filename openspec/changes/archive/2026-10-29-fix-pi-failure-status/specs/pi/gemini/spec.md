## ADDED Requirements

### Requirement: A Google failure takes its status from Google's error envelope
On `google-generative-ai` and `google-vertex` models, when an error message has no diagnostic code, the port SHALL parse `errorMessage` whole as JSON and, when it is an object whose `error` is an object with an integer `code`, map that `code` as the status. Otherwise the category MUST stay `unknown`. No substring or keyword match SHALL be made.

#### Scenario: A 429 from Gemini is a rate limit
- **GIVEN** the fake Gemini server answering `429` with Google's error body
- **WHEN** a step runs on a `google` model pointed at it
- **THEN** it SHALL fail with category `rate_limit`

#### Scenario: A 403 from Gemini is an authentication failure
- **GIVEN** the fake Gemini server answering `403` with Google's error body
- **WHEN** a step runs on a `google` model pointed at it
- **THEN** it SHALL fail with category `authentication_failed`

#### Scenario: A Google error that is not its envelope stays unknown
- **WHEN** a Google error message is not JSON, or is JSON without an integer `error.code`
- **THEN** the step SHALL fail with category `unknown`
