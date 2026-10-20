## ADDED Requirements

### Requirement: The system prompt ends with the no-workspace note
The `--system-prompt` value `claudeArgs` builds SHALL end with this note, after `\n\n` when the system text is non-empty and alone when it is empty: `This step has no workspace. The environment details you may see (working directory, whether it is a git repository, platform) describe the process running this step, not the project the step is about; ignore them.` The port and the provider SHALL both pass it.

#### Scenario: The note follows the system text
- **WHEN** `claudeArgs({ system: "s", model: "m" })` is called
- **THEN** the value after `--system-prompt` SHALL be `s`, then `\n\n`, then the note exactly

#### Scenario: An empty system text is the note alone
- **WHEN** `claudeArgs({ system: "", model: "m" })` is called
- **THEN** the value after `--system-prompt` SHALL be the note exactly

#### Scenario: The port passes the note
- **WHEN** the triage script runs through `createClaudeCodeReasoningPort` with a recording runner
- **THEN** every `--system-prompt` value SHALL contain `You triage bug reports` and end with the note

#### Scenario: The provider passes the note
- **WHEN** a provider request whose system content is `Be kind.` is completed with a recording runner
- **THEN** the value after `--system-prompt` SHALL be `Be kind.`, then `\n\n`, then the note exactly

## MODIFIED Requirements

### Requirement: Each turn is one headless claude -p invocation with a fixed argv
`claudeArgs({ system, model, schema?, maxTurns? })` SHALL return, in order: `-p`, `--safe-mode`, `--model`, `<model>`, `--tools`, `""`, `--no-session-persistence`, `--output-format`, `json`, `--system-prompt`, `<system with the no-workspace note>`; then `--json-schema`, `<JSON.stringify(schema)>` when a schema is given; then `--max-turns`, `<String(maxTurns)>` when given. The prompt MUST NOT be in argv: it goes on stdin.

#### Scenario: Headless, safe mode, no tools, no saved session
- **WHEN** `claudeArgs({ system: "s", model: "m" })` is called
- **THEN** it SHALL return exactly `["-p", "--safe-mode", "--model", "m", "--tools", "", "--no-session-persistence", "--output-format", "json", "--system-prompt", <"s", "\n\n" and the no-workspace note>]`

#### Scenario: A schema and a turn bound are appended in order
- **WHEN** it is called with `schema: { type: "object" }` and `maxTurns: 3`
- **THEN** the argv SHALL end with `--json-schema`, `{"type":"object"}`, `--max-turns`, `3`

### Requirement: spawnRunner runs the binary outside any project, with a timeout
`spawnRunner(binary, timeoutMs, signal?, cwd?)` SHALL return a runner that spawns `binary` with the given argv and environment, writes the input to stdin and closes it, and resolves `{ code, stdout, stderr }` on close. Without `cwd`, each call SHALL run in a new empty directory made by `mkdtemp` under `os.tmpdir()`, removed before the call resolves; with `cwd`, there. It MUST send `SIGTERM` after `timeoutMs`, and on abort. A spawn failure MUST resolve with `spawnError`, never reject.

#### Scenario: A missing binary resolves with a spawn error
- **WHEN** a runner for a binary that does not exist is run
- **THEN** it SHALL resolve with `code: null` and a `spawnError`

#### Scenario: A process past its timeout is terminated
- **GIVEN** a runner with `timeoutMs` 50 for a process that sleeps
- **WHEN** it runs
- **THEN** the process SHALL receive `SIGTERM` and the runner SHALL resolve with `code` `null`

#### Scenario: Each call runs in a fresh empty directory, removed after
- **GIVEN** a runner without `cwd` for a process that prints its working directory and the entries in it
- **WHEN** it is run twice
- **THEN** each run SHALL report a different directory under `os.tmpdir()`, neither equal to `os.tmpdir()`, each with no entries
- **AND** neither directory SHALL exist after its run resolves

#### Scenario: A given cwd is used and left in place
- **GIVEN** a runner with `cwd` set to an existing directory holding one file
- **WHEN** a process that prints its working directory runs
- **THEN** it SHALL report that directory, and the directory and its file SHALL still exist after the run resolves

### Requirement: The port is one claude process per step and stateless
`createClaudeCodeReasoningPort(options)` SHALL return a port whose `reason(request)` runs the runner once with `claudeCodeArgs(request, options)`, `request.prompt` as stdin, and `claudeCodeEnv(process.env)`, then returns `toClaudeCodeOutcome(result, request.outputSchema !== undefined).step`. It SHALL call `onResult` with every parsed result. Without `runner`, it spawns `binary` (default `claude`) with `timeoutMs` (default `300000`) and `cwd`.

#### Scenario: Structured output sets variables on the triage example
- **GIVEN** a runner answering the triage example's structured step with `structured_output` `{ severity: "high", urgent: true }`
- **WHEN** the triage script runs through the port
- **THEN** the run SHALL set those variables and the prompt SHALL have been passed on stdin

#### Scenario: onResult sees each parsed result
- **GIVEN** a port with `onResult`
- **WHEN** a step's process prints a JSON result
- **THEN** `onResult` SHALL be called with the parsed object

#### Scenario: The port runs claude in its cwd option
- **GIVEN** a fake `claude` binary that answers with its working directory as `result`, and a port with that `binary` and `cwd` set to an existing directory
- **WHEN** a text step runs through the port
- **THEN** the step's answer SHALL be that directory

### Requirement: The provider spawns per request with the request's abort signal
Without a `runner` option, the provider SHALL build a fresh `spawnRunner(binary ?? "claude", timeoutMs ?? 300000, signal, cwd)` per request, with the request's `StreamOptions.signal` and the `cwd` option. A `runner` option replaces spawning and receives that signal. The provider never passes `--max-turns`.

#### Scenario: A test runner replaces spawning
- **GIVEN** `claudeCodeProvider({ runner: () => fake })`
- **WHEN** a request is completed
- **THEN** `fake` SHALL receive the argv, the prompt and an environment with no `ANTHROPIC_API_KEY`

#### Scenario: The provider runs claude in its cwd option
- **GIVEN** a fake `claude` binary that answers with its working directory as `result`, and `claudeCodeProvider({ binary, cwd })` with `cwd` set to an existing directory
- **WHEN** a request with no tools is completed
- **THEN** the message's text SHALL be that directory
