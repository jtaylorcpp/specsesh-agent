# pi/ollama Specification

## Purpose
A pi-ai provider for a local Ollama server, so a script runs on a model the user has pulled, with no API key and nothing leaving the machine.

## Requirements

### Requirement: ollamaProvider is a keyless provider on the OpenAI-compatible API
`ollamaProvider(options?)` from `@specsesh/agent/pi` SHALL return a pi-ai provider with id `ollama` and name `Ollama (local)`, whose chat models use pi-ai's `openai-completions` API against `<baseUrl>/v1`. Its auth MUST resolve with no environment variable set, and MUST NOT read any credential.

#### Scenario: A step reaches the server's chat endpoint
- **GIVEN** a fake Ollama server and `ollamaProvider({ baseUrl: <server>, models: ["tiny:1b"] })` set on a pi-ai collection
- **WHEN** the collection completes a one-message request on model `tiny:1b`
- **THEN** the server SHALL receive one `POST /v1/chat/completions` whose body's `model` is `tiny:1b`
- **AND** the reply's text SHALL be the server's answer

#### Scenario: No credential is needed
- **GIVEN** no `OPENAI_API_KEY`, `OLLAMA_API_KEY` or other key in the environment
- **WHEN** `getAuth("ollama")` is called on a collection holding the provider
- **THEN** it SHALL resolve, not `undefined`

### Requirement: The server URL comes from the option, then OLLAMA_HOST, then the default
The base URL SHALL be `options.baseUrl`, else `OLLAMA_HOST`, else `http://localhost:11434`, with any trailing `/` removed. A value with no scheme SHALL get `http://`. `ollamaBaseUrl(options?)` SHALL return it.

#### Scenario: The default is localhost
- **GIVEN** `OLLAMA_HOST` is unset
- **WHEN** `ollamaBaseUrl()` is called
- **THEN** it SHALL return `http://localhost:11434`

#### Scenario: OLLAMA_HOST without a scheme gets one
- **GIVEN** `OLLAMA_HOST=127.0.0.1:9999/`
- **WHEN** `ollamaBaseUrl()` is called
- **THEN** it SHALL return `http://127.0.0.1:9999`

#### Scenario: The option wins over OLLAMA_HOST
- **GIVEN** `OLLAMA_HOST=127.0.0.1:9999`
- **WHEN** `ollamaBaseUrl({ baseUrl: "http://box:11434" })` is called
- **THEN** it SHALL return `http://box:11434`

### Requirement: The provider's models are the pulled models
Refreshing the provider SHALL fetch `GET <baseUrl>/api/tags` and publish one chat model per entry of `models`, by its `name`, in the server's order. `options.models` SHALL be a static list of ids available before any refresh. `ollamaModel(id, options?)` SHALL return the model for any id: provider `ollama`, name `<id> (Ollama)`, `reasoning` false, input `["text"]`, zero cost, `contextWindow` 32768 and `maxTokens` 8192.

#### Scenario: A refresh lists the pulled models
- **GIVEN** a fake server whose `/api/tags` lists `qwen3:8b` then `llama3.2:3b`
- **WHEN** the provider is set on a collection and the collection is refreshed for `ollama`
- **THEN** `getModels("ollama")` ids SHALL be `qwen3:8b`, `llama3.2:3b`

#### Scenario: Any id makes a model
- **WHEN** `ollamaModel("mistral:7b")` is called
- **THEN** it SHALL have id `mistral:7b`, provider `ollama`, api `openai-completions` and baseUrl `http://localhost:11434/v1`

### Requirement: registerOllama sets and refreshes the provider without throwing
`registerOllama(models, options?)` SHALL set `ollamaProvider(options)` on the collection, refresh it for `ollama`, and resolve `{ ok: true, baseUrl, models: <count> }`, after which each pulled model resolves through `getModel`. When the server can't be reached or answers badly it SHALL resolve `{ ok: false, baseUrl, reason }`, `reason` non-empty, leave the provider set, and never reject.

#### Scenario: A reachable server's models resolve
- **GIVEN** a fake server listing `qwen3:8b`
- **WHEN** `registerOllama(models, { baseUrl: <server> })` resolves
- **THEN** it SHALL be `{ ok: true, baseUrl: <server>, models: 1 }` and `models.getModel("ollama", "qwen3:8b")` SHALL be defined

#### Scenario: An unreachable server is reported, not thrown
- **GIVEN** a base URL on a port nothing listens on
- **WHEN** `registerOllama(models, { baseUrl })` resolves
- **THEN** `ok` SHALL be `false`, `reason` SHALL be non-empty, `models.getProvider("ollama")` SHALL be defined, and `models.getModels("ollama")` SHALL be empty

### Requirement: Structured steps force submit_result over the wire
A structured step on an `ollama` model SHALL send `tool_choice` naming `submit_result`, as `forceTool` does for `openai-completions`. A returned `submit_result` call SHALL become the step's structured result. A reply with no such call SHALL fail the step as any provider's does, setting no variable.

#### Scenario: A forced tool call becomes the structured result
- **GIVEN** a fake server that answers a `submit_result` tool call with `{"label":"bug"}`
- **WHEN** a one-step script setting `label` from a structured result runs on `createPiReasoningPort` with that `ollama` model
- **THEN** the request body SHALL carry `tool_choice` naming `submit_result`, the run SHALL complete, and `label` SHALL be `bug`

#### Scenario: A text-only reply fails the step
- **GIVEN** a fake server that answers the same step with text and no tool call
- **WHEN** the script runs
- **THEN** the run SHALL end `failed` and the failure message SHALL contain `received none`
