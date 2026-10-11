## Why

The adapter package (`agentscript-pi`) is how scripts reach a model: the pi-ai port for any provider, and the claude-code port and pi provider that run steps on the user's own Claude subscription. Like the core and durable layers before it, its behaviour exists only as code and tests. Packaging is next, and it will move this package, so it needs a spec to change against.

## What Changes

No code changes. Baseline specs only, ADDED, for behaviour that exists today:

- `pi/port`: the pi-ai `ReasoningPort`, the result tool, per-API tool forcing, outcome mapping from structured fields, HTTP status categories, and model resolution.
- `pi/claude-code`: the headless `claude -p` port (exact argv, environment, process runner, outcome mapping), the `claude-code` pi-ai provider (models, transcript flattening, one-tool limit, tool calls, errors, usage), and the hard line that Claude Code's OAuth token is never read.
- `pi/cli`: `agentscript-pi run` and `models`.

## Out of scope

- Any behaviour change, including the findings listed in `openspec/parked.md`.
- Packaging: the next change.

## Impact

- New: `openspec/specs/pi/{port,claude-code,cli}/spec.md` once archived.
- `tasks.md` lists the scenarios no test pins yet.
