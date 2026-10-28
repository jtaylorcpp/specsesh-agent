## Why

Feedback on 0.4.0: a host can't stop a claude-code step. The pi port takes a `signal`, and the claude-code pi provider honours each request's signal, but `createClaudeCodeReasoningPort` has none. A step runs until `claude` finishes or `timeoutMs` (5 minutes) passes. On a tool step, the bridge stays up all that time and keeps calling the host.

## What Changes

- **`createClaudeCodeReasoningPort({ signal })`**, an `AbortSignal` for every step the port runs, as on the pi port.
  - **Already aborted:** a step fails at once (category `unrecognised`, from `toFailureCategory("aborted")`, as the pi port reports an aborted request). Nothing is spawned and no bridge is started.
  - **Aborted mid-step:** the `claude` process gets `SIGTERM`. A tool step's bridge is closed, and any later call through it is answered as an error without reaching the host. `reason` resolves failed without waiting for the process to exit.
  - **With a `runner` option**, the signal can't kill anything, since a runner has no signal parameter. `reason` still resolves on abort, and the bridge is still closed.

## Out of scope

- A per-step signal. `ReasoningPort.reason` takes none, and the pi port's signal is port-wide too.
- Cancelling a host call already in flight. A `PiToolHost` takes no signal; `registryHost` has its own `signal` option.
- Ctrl-C handling in the bins.
- Reporting the calls a stopped step made. That is the next change, `add-tool-calls-on-failures`.

## Capabilities

- **Modified:** `pi/claude-code`.

## Impact

- `packages/agent/src/claude-code/claude-code.ts`: the option, the race in `reason`, and the bridge handler's refusal after an abort.
- Tests: `__tests__/pi/claude-code-abort.test.ts` (new), with a sleeping fake `claude` and the fake bridge.
- Docs: `docs/llm/agent.md` and `docs/providers/claude-code.md`.
