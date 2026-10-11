## Context

Baseline of existing behaviour; this records how the adapter is put together so the specs can stay at the level of public behaviour.

## Shape

```
pi port          ReasoningPort → models.complete(model, { systemPrompt, [user prompt], tools? })
                 structured step: one submit_result tool, forced per wire API (forceTool)
                 message → StepOutcome from stopReason + diagnostic status only (toOutcome)

claude-code port ReasoningPort → one `claude -p --safe-mode --tools "" ...` process per step
                 prompt on stdin, system prompt as a flag, --json-schema for structured steps

claude-code      pi-ai Provider "claude-code": pi request → flattened system prompt + transcript
provider         → the same claude -p argv; one offered tool becomes --json-schema and comes
                 back as a toolCall, so pi (and pi-durable) execute it as usual
```

## Decisions

- **Never the OAuth token, never `--bare`.** The subscription path is Claude Code making the turn as the user. `--bare` forces API-key auth; `--safe-mode` keeps the user's CLAUDE.md, hooks and MCP out of every step. `ANTHROPIC_API_KEY` is stripped so the subscription, not an API key, is billed.
- **Categories come from structured facts.** HTTP status or Claude Code's `api_error_status` / `stop_reason`, never message text.
- **The pi port has no loop**, so it never reports `cut-short`; Claude Code owns its own turn loop, so the claude-code port can.
- **The provider refuses more than one pi tool** rather than half-supporting tools Claude Code cannot run.

## Risks

- `claude -p` flags and its JSON result shape are Claude Code's, not ours; a CLI update can change them.
- The provider registers only four model ids, so pi-durable can only select those (see `openspec/parked.md`).
