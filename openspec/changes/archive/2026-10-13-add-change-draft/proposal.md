## Why

`pnpm task` speaks in loops: you start one, it prints an id, and you answer that id. The principal wants a flow that speaks in changes, with one verb for each thing that happens to a change: `pnpm change draft`, `pnpm change approve`, `pnpm change build`, `pnpm change close`. You name the change, and the CLI finds the loop. This change adds the CLI and its first verb. `approve`, `build` and `close` follow, one change each.

## What Changes

- **A fourth bin, `agentscript-change`, run as `pnpm change`.** It takes a command and a change id, resolves the database, provider and model as `agentscript-task` does, and never prompts.
- **`pnpm change draft <change> [<feedback>] [--intent <words> | --intent-file <path>]`.**
  - A new change needs an intent. It gets `intent.md` and a draft loop over `SPEC_STAGES` (`add-draft-loop`).
  - On a change waiting for an answer, feedback answers it. That is a revision request at a review, or the answer to a stage's question. Without feedback, `draft` shows what is waiting again and starts nothing, so a change never has two drafts at once.
  - On a change with nothing waiting, `draft` continues from the first stage without a current approval. With every stage approved, it says so.
- **Output** names the change, the approved stages and the current stage's drafts, and ends with the next command. Until `add-change-approve`, approving goes through `pnpm task answer <id> --decision approve`.
- **Exit codes:** `0` waiting for review or drafted, `1` on a question or a failed draft, `2` on usage or a refusal.

## Out of scope

- `approve`: `add-change-approve`. `build`: `add-change-build`. `close`: `add-change-close`, which also names the bin in the README.
- A listing of every change and its state (`pnpm change` with no change). It's parked.

## Capabilities

- **New:** `change/cli`.
- **Modified:** `package/distribution`: the four CLIs are compiled bins.

## Impact

- New: `packages/agent/src/bin/agentscript-change.ts`, `src/task/change-state.ts`, `cmd-draft.ts`, `change-output.ts`. Updated: `packages/agent/package.json` (`bin`), the root `package.json` (`change`), `guides/09-spec-agent.md`.
- Depends on `add-draft-loop`, archived first.
