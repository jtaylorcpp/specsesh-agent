## Why

After `add-change-draft`, approving a stage still means copying a loop id into `pnpm task answer <id> --decision approve`. The principal wants approval to be its own verb on the change: `pnpm change approve <change>`.

## What Changes

- **`pnpm change approve <change> [--principal <name>]`** answers the change's draft loop that is waiting for review with `approve`. The approval records `--principal`, which defaults to `git config user.name`, then `$USER`. The new run drafts the next stage and is printed like `draft`.
  - A change waiting on a question is refused, and the output names `pnpm change draft <change> "<answer>"`.
  - A change with nothing under review is refused.
- **`approve` is no longer feedback.** `pnpm change draft <change> approve` is refused, and the output names `pnpm change approve <change>`, so an approval is always explicit.
- **The review lines** end with `pnpm change approve <change>` instead of the loop-id command.
- **Slices:** the run that approves a proposal with `slices.md` lists `pnpm change draft <id> --intent "<intent>"` for each later slice.

## Out of scope

- Approving several stages at once. Each stage gets its own review.

## Capabilities

- **Modified:** `change/cli`.

## Impact

- New: `packages/agent/src/task/cmd-approve.ts`. Updated: `cmd-draft.ts`, `change-output.ts`, `src/bin/agentscript-change.ts`, the package README.
- Depends on `add-change-draft`, archived first.
