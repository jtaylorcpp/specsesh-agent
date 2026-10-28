## Why

`add-claude-code-tools` and `add-durable-claude-code-tools` are well covered at the seams, but three gaps remain before they are published.

- **Session paths.** No test covers more than one call per session: calls one after another, results for calls made together, or `claude` exiting while a call is held.
- **A durable crash.** No automated test kills a claude-code durable run during a tool call and resumes it. That was verified once by hand.
- **Real Claude Code.** Nothing automated re-checks it. Tool steps replace `--safe-mode` with flags whose isolation was measured by hand on Claude Code 2.1.310. If a later Claude Code loads the user's configuration under those flags, or stops serving `--mcp-config` tools, no test notices.

## What Changes

- **Three session scenarios** in the provider's tests: calls one after another share one process; every result for calls made together is handed back; a process that exits while a call is held ends the session cleanly.
- **A crash scenario** for the durable CLI. The fake `claude` calls a tool whose `execute` kills the host process. Then `resume` completes on a fresh `claude` that is given the transcript.
- **`pnpm test:claude-code`**, an opt-in live check on the user's subscription, never part of `pnpm test`. It skips when `claude` is missing or not logged in. It checks:
  - the isolation, by input tokens against `--safe-mode`, and by a project CLAUDE.md sentinel with a positive control;
  - a real tool call through `mcpBridge`, on a value the model can't guess;
  - one durable run through the bin.

## Out of scope

- New behaviour. This change adds tests and one script only.
- Running the live check in CI. It needs a logged-in `claude`.
- Models other than Haiku in the live check.

## Capabilities

- **Modified:**
  - `pi/claude-code`;
  - `durable/cli`.

## Impact

- Tests:
  - `__tests__/pi/claude-code-sessions.test.ts`;
  - `__tests__/durable/claude-code-tools.test.ts`, plus a fixture tools module;
  - `__tests__/live/claude-code-tools.live.test.ts` (new).
- Scripts: a `test:claude-code` script in the root and agent `package.json`s.
- Docs: `CLAUDE.md` (Commands) and `docs/providers/claude-code.md`; `openspec/parked.md` (the probes' watch item points at the script).
