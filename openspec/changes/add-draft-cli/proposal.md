## Why

`add-draft-loop` drafts a whole change from the library, but a user can't run it yet. The principal wants a command for drafting a change: give it the intent once, then just answer each review until the change is ready to execute. `spec` stays for rerunning a single stage. `draft` becomes the way to start.

## What Changes

- **`agentscript-task draft <change> [--intent <words> | --intent-file <path>]`.**
  - It starts a draft loop over `SPEC_STAGES` and waits for it.
  - A new change needs an intent and gets `intent.md`, as with `spec`.
  - It refuses a change that already has a spec or draft loop waiting for an answer, and names that loop's `answer` command, so two loops never draft the same stage.
- **`answer` routes a draft loop to `answerDraftLoop`.** It waits for the new run and prints it the way `draft` does. One answer approves a stage and drafts the next.
- **`status` lists draft loops** as `draft <stage>`.
- **Exit codes:** `0` when a draft ends waiting for review or converges; `1` on a question, or when it is exhausted or fails.
- **Text output** lists the approved stages, then the current stage's drafts. It ends with the next step:
  - after a review, the approve and revise commands;
  - once every stage is approved, the command to execute the change;
  - when a proposal with `slices.md` is approved, a `draft` command for each later slice.

## Out of scope

- JSON Lines events for draft loops.
- A command to execute the whole change: `add-build-cli`. Until then the last line points at `--next-group`.

## Capabilities

- **Modified:** `task/cli`.

## Impact

- New: `packages/agent/src/task/draft-cli.ts`. Updated: `src/bin/agentscript-task.ts`, `src/task/status.ts`, the package README's CLI section, `guides/09-spec-agent.md`.
- Depends on `add-draft-loop`, archived first.
