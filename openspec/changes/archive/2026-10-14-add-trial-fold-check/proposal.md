## Why

Some spec problems only show up after a change is folded into the specs, and today nothing finds them before `close` (gaps.md #17). In openspec 1.14.1, `validate --strict` checks the length of ADDED requirements in a delta but not MODIFIED ones. Only the folded spec reports those. add-spec-amendments-judge passed drafting, its build and its verify. It then failed `close`'s trial fold on three MODIFIED requirements over 500 characters, after the code was already done. Running the same trial fold earlier, at the specs stage's gate and at the end of `pnpm change build`, finds these problems while they are still cheap to fix.

## What Changes

- The specs stage's gate runs `close`'s trial fold: it folds the change into a temporary copy of `openspec/` and runs `openspec validate --specs --strict` there. Each error or warning becomes an issue on the draft, so the spec loop keeps iterating until the folded specs validate.
- `pnpm change build` runs the same trial fold after its change check. If the fold fails, the build ends blocked with the fold's output, not built.
- Both use the trial fold that `add-spec-amendments-cli` shared from `cmd-close.ts`. Neither gets a copy of its own.

## Out of scope

- Changing openspec, including its `validate --strict` length checks.
- `close`, which already runs the trial fold.
- The drafting gates of the other stages (proposal, design, tasks).

## Capabilities

**Modified:**
- `spec/stages`: the specs stage's gate also runs the trial fold and reports each error or warning from the fold as an issue on the draft.
- `task/change`: after the change check, the change loop runs the trial fold. A failing fold ends the build blocked with the fold's output.

## Impact

- The code for the specs stage's gate and for the change loop's build. Both call the shared trial fold from `cmd-close.ts` (shared by `add-spec-amendments-cli`).
- A change whose folded specs fail `openspec validate --specs --strict` can no longer get its specs stage approved or end `pnpm change build` as built.
- Each specs gate run and each build creates and removes a temporary copy of `openspec/`.
