## ADDED Requirements

### Requirement: A signal stops the port's steps
`createClaudeCodeReasoningPort` SHALL take `signal?: AbortSignal`, passed to the runner it spawns with. When it is aborted before or during a step, `reason` SHALL resolve `{ kind: "failed", category: toFailureCategory("aborted"), message: "the claude-code step was aborted" }` without waiting for the process. Before a step, nothing is spawned and no bridge started. During a tool step, the bridge SHALL be closed before `reason` resolves.

#### Scenario: An aborted signal starts nothing
- **GIVEN** a port with a tool host, a fake bridge, a recording runner and an already aborted `signal`
- **WHEN** a request offering a tool is reasoned
- **THEN** the step SHALL fail with category `unrecognised` and a message containing `aborted`, and neither the runner nor the bridge SHALL have been called

#### Scenario: Aborting a text step kills claude
- **GIVEN** a port whose `binary` is a fake `claude` that records its pid and sleeps 30 s, and a `signal`
- **WHEN** the signal is aborted 100 ms into a text step
- **THEN** `reason` SHALL resolve failed with a message containing `aborted` within 2 s, and the recorded process SHALL no longer exist

#### Scenario: Aborting a tool step closes the bridge
- **GIVEN** a port with a tool host, a fake bridge, a runner that never resolves, and a `signal`
- **WHEN** the signal is aborted during a tool step
- **THEN** `reason` SHALL resolve failed with a message containing `aborted`, and the bridge SHALL have been closed

### Requirement: The bridge refuses calls once the step is aborted
After the port's `signal` aborts, the bridge handler SHALL answer every call `{ ok: false, text: "the claude-code step was aborted" }` without calling the host and without recording it.

#### Scenario: A call after the abort never reaches the host
- **GIVEN** a tool step whose runner keeps the bridge handler, and the port's `signal` aborted
- **WHEN** the handler is called with an offered tool and valid arguments
- **THEN** it SHALL answer `ok: false` with `aborted`, and the host SHALL not have been called
