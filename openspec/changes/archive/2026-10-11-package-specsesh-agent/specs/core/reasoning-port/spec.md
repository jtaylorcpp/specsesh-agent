## MODIFIED Requirements

### Requirement: One reasoning step leaves through one injected port
The interpreter SHALL send every reasoning step through a caller-supplied `ReasoningPort`, exported from `@specsesh/agent/interpreter`, which has exactly one method: `reason(request: ReasoningRequest): Promise<StepOutcome>`. The runner SHALL call `reason` once per dispatched step. `src/authoring/` and `src/interpreter/` SHALL hold exactly one `.reason(` call site, in `src/interpreter/run.ts`.

#### Scenario: A reasoning step runs through the injected port
- **GIVEN** a document with one subagent holding a prompt line
- **WHEN** it is run with a recording port
- **THEN** the port SHALL receive exactly one request
- **AND** the result's single step SHALL carry that request and the port's outcome

### Requirement: There is no default port
The interpreter SHALL construct no default port. `run` with no `port` SHALL reject with `NoReasoningPortError` before parsing or dispatching anything. The error's `name` SHALL be `"NoReasoningPortError"`, its message SHALL begin `no reasoning port was provided`, say that the package constructs no default, and name the package as `@specsesh/agent`, never `@coopcli/agentscript`.

#### Scenario: No port is injected
- **WHEN** `run(source)` is called with no `port`
- **THEN** it SHALL reject with `NoReasoningPortError`
- **AND** nothing SHALL be dispatched

#### Scenario: No port is refused before the document is read
- **WHEN** `run` is called with no `port` and an unparsable source
- **THEN** it SHALL reject with `NoReasoningPortError`, not a document error

#### Scenario: The message names the published package
- **WHEN** a `NoReasoningPortError` is constructed
- **THEN** its message SHALL contain `@specsesh/agent declares the port`
- **AND** it SHALL NOT contain `@coopcli`

### Requirement: The core package reaches no model on its own
No required dependency of `@specsesh/agent` SHALL be a model SDK (a name matching `anthropic`, `openai`, `@google/gen`, `bedrock`, `langchain`, `@ai-sdk`, `ollama` or `claude-code`), and no file in `src/authoring/` or `src/interpreter/` SHALL import one, contain an `http(s)://` literal, call `fetch(`, construct a `WebSocket` or `XMLHttpRequest`, read `process.env`, or mention an API key or bearer token.

#### Scenario: The package imports no model client
- **WHEN** the manifest's `dependencies` and every `.ts` file under `src/authoring/`, `src/interpreter/` and `__tests__/core/` are scanned
- **THEN** no dependency or import SHALL match a model-client name
- **AND** no file under `src/authoring/` or `src/interpreter/` SHALL construct an endpoint, make a network call or read a credential

### Requirement: The core package imports only what it declares
Every import in `src/authoring/`, `src/interpreter/` and `__tests__/core/` SHALL resolve to a declared dependency or dev dependency, a Node built-in, or a relative path inside those directories.

#### Scenario: Imports stay inside the declared graph
- **WHEN** every import specifier under `src/authoring/`, `src/interpreter/` and `__tests__/core/` is resolved
- **THEN** each SHALL be a declared dependency, a `node:` built-in or a relative path inside those directories
