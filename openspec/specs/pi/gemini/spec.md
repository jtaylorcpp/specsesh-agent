# pi/gemini Specification

## Purpose
Gemini, through pi-ai's built-in `google` provider on `GEMINI_API_KEY`, as a first-class provider: a base URL that can be pointed elsewhere, a key check that runs before anything starts, and steps, tool loops and streaming that are tested on Gemini's wire format.

## Requirements

### Requirement: The Gemini helpers are exported from the pi entry
`@specsesh/agent/pi` SHALL export `GEMINI_PROVIDER`, equal to `"google"`, `GEMINI_DEFAULT_BASE_URL`, equal to `"https://generativelanguage.googleapis.com/v1beta"`, `geminiBaseUrl`, `geminiKeyIssue` and `registerGemini`.

#### Scenario: The constants match pi's google provider
- **WHEN** the pi entry is imported beside pi-ai's built-in collection
- **THEN** `GEMINI_PROVIDER` SHALL be a provider in the collection, and its models' `baseUrl` SHALL equal `GEMINI_DEFAULT_BASE_URL`

### Requirement: The API URL comes from the option, then GEMINI_BASE_URL, then the default
`geminiBaseUrl(options?)` SHALL return `options.baseUrl`, else `GEMINI_BASE_URL`, else `GEMINI_DEFAULT_BASE_URL`, with any trailing `/` removed. An empty value SHALL count as unset.

#### Scenario: The default is Google's endpoint
- **GIVEN** `GEMINI_BASE_URL` is unset
- **WHEN** `geminiBaseUrl()` is called
- **THEN** it SHALL return `https://generativelanguage.googleapis.com/v1beta`

#### Scenario: GEMINI_BASE_URL loses its trailing slash
- **GIVEN** `GEMINI_BASE_URL=http://127.0.0.1:9999/v1beta/`
- **WHEN** `geminiBaseUrl()` is called
- **THEN** it SHALL return `http://127.0.0.1:9999/v1beta`

#### Scenario: The option wins over GEMINI_BASE_URL
- **GIVEN** `GEMINI_BASE_URL=http://127.0.0.1:9999`
- **WHEN** `geminiBaseUrl({ baseUrl: "http://gateway/v1beta" })` is called
- **THEN** it SHALL return `http://gateway/v1beta`

### Requirement: registerGemini points google at the URL and checks the key without throwing
`registerGemini(models, options?)` SHALL, when `geminiBaseUrl(options)` differs from the default, set the `google` provider with every model's `baseUrl` replaced by it. It SHALL resolve `{ ok: true, baseUrl, models: <count> }` when `GEMINI_API_KEY` is set (in `options.env`, else the process), else `{ ok: false, baseUrl, reason: "GEMINI_API_KEY is not set" }`. It SHALL make no request and never reject.

#### Scenario: A set key and a fake URL resolve
- **GIVEN** `GEMINI_API_KEY=test` in `env` and a fake server URL
- **WHEN** `registerGemini(models, { baseUrl: <server>, env })` resolves
- **THEN** `ok` SHALL be `true`, and `models.getModel("google", "gemini-3.5-flash").baseUrl` SHALL be the server URL

#### Scenario: A missing key is reported, not thrown
- **GIVEN** an `env` with no `GEMINI_API_KEY`
- **WHEN** `registerGemini(models, { env })` resolves
- **THEN** it SHALL be `{ ok: false, baseUrl: GEMINI_DEFAULT_BASE_URL, reason: "GEMINI_API_KEY is not set" }`, and `geminiKeyIssue(env)` SHALL return that reason

### Requirement: Steps, tool loops and streaming work over the Gemini wire
On a `google` model, a structured step SHALL send `functionCallingConfig` mode `ANY` and take a returned `submit_result` call as its result; a reply with no call SHALL fail with `received none`. A tool loop SHALL send each offered tool's result back as a `functionResponse`, and a listening step SHALL stream text as `text_delta`.

#### Scenario: A forced function call becomes the structured result
- **GIVEN** a fake Gemini server that answers a `submit_result` function call with `{"label":"bug"}`
- **WHEN** a one-step script setting `label` from a structured result runs on `createPiReasoningPort` with that `google` model
- **THEN** the request SHALL carry `toolConfig.functionCallingConfig.mode` `ANY`, the run SHALL complete, and `label` SHALL be `bug`

#### Scenario: A text-only Gemini reply fails the step
- **GIVEN** a fake Gemini server that answers the same step with text and no function call
- **WHEN** the script runs
- **THEN** the run SHALL end `failed` and the failure message SHALL contain `received none`

#### Scenario: A Gemini tool call is answered with a functionResponse
- **GIVEN** a pi port with a tool host offering `lookup`, and a fake Gemini server that answers a `lookup` call, then text
- **WHEN** a step offering `lookup` is reasoned
- **THEN** the second request SHALL carry a `functionResponse` named `lookup` with the host's outputs, and the step SHALL be answered with that text and one tool call

#### Scenario: A listening Gemini step streams its text
- **GIVEN** a fake Gemini server that answers in two SSE chunks, `"Hel"` then `"lo"`
- **WHEN** a text step is reasoned with a stream sink
- **THEN** the sink SHALL receive `text_delta` `"Hel"` then `"lo"`, and the step SHALL be answered with `"Hello"`

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
