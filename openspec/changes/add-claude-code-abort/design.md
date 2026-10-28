## Context

`createClaudeCodeReasoningPort` builds one runner at creation: `spawnRunner(binary, timeoutMs, undefined, cwd)`. `spawnRunner` already takes a signal and sends `SIGTERM` on abort; the provider uses that for each request's signal. `runToolStep` starts the bridge, runs the runner, and closes the bridge in `finally`. The pi port takes `signal` as a port option and maps an aborted request to `failed` with `toFailureCategory("aborted")` (`unrecognised`).

## Decisions

1. **`signal?: AbortSignal`** on `ClaudeCodeReasoningPortOptions`, passed to `spawnRunner` when the port builds its runner. It is port-wide, like the pi port's: once aborted, every `reason` on the port fails as aborted.
2. **The outcome.** `{ kind: "failed", category: toFailureCategory("aborted"), message: "the claude-code step was aborted" }`. It is the same category the pi port gives an aborted request, so a caller branches the same way on either port. `onResult` is not called.
3. **Aborted before the step:** that failure, with no runner call and no bridge.
4. **Aborted during the step:** `reason` races the runner against the signal's `abort` event, and abort wins as soon as it fires.
   - **Spawned processes.** The abort reaches `spawnRunner`, which sends `SIGTERM`. The port doesn't wait for the process to close.
   - **Tool steps.** The bridge's `close()` is awaited before `reason` resolves, so when `reason` returns, nothing serves the step's tools.
   - **The runner's promise** is left to settle by itself, with a `catch` attached so it can't reject unhandled.
   - **A `runner` option** gets no signal, because the `Runner` type takes none. So a custom runner keeps running until it finishes, but `reason` has already resolved and the bridge is closed.
5. **The bridge handler after an abort** answers `{ ok: false, text: "the claude-code step was aborted" }` without calling the host and without recording the call. It also covers a call in flight at the moment of the abort and one arriving before the bridge closes. A host call already running is not cancelled (`PiToolHost` takes no signal); its result goes to a closed bridge.
6. **Listeners.** The `abort` listener is added per `reason` call and removed when it settles, so a long-lived port doesn't build up listeners.

## Testing

- **Text steps:** a fake `claude` script that writes its pid to a file and sleeps 30 s, through the real `spawnRunner` (`binary` option). With `signal` aborted 100 ms in, `reason` resolves failed within 2 s and the pid is gone (`process.kill(pid, 0)` throws).
- **Tool steps:** the fake bridge from `claude-code-tools.test.ts`, plus a runner that never resolves and keeps the handler. The tests assert that, after an abort, `reason` resolves failed, `close` has run, and a handler call answers not-ok without reaching the host.
- **Already aborted:** no runner call and no bridge start.
