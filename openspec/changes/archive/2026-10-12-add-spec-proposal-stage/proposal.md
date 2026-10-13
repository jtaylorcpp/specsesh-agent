## Why

`add-spec-loop` and `add-spec-review` give us a loop that drafts, checks and asks for review, but no stage to run in it. The first stage turns the user's words into `proposal.md`. It's where a change is kept small or lets itself grow, so its gate checks the shape a proposal must have, that the capabilities it names are real, and the size budget's capability limit.

## What Changes

- **`proposalStage`** (`./task`):
  - owns `proposal.md` and follows nothing;
  - its bundled script is `spec-proposal.agent`;
  - it seeds `base` with every existing capability, one line each: `<area>/<name>: <purpose>`.
- **The gate:**
  - the five sections `## Why`, `## What Changes`, `## Out of scope`, `## Capabilities` and `## Impact`, in that order;
  - a Capabilities section naming at least one path, under `**New:**` or `**Modified:**`;
  - a modified path must exist in `openspec/specs/`, and a new one must not;
  - `proposalSizeIssues` from `openspec/size`, so more than two capabilities sends the draft back.
- **`spec-proposal.agent`**: one structured step. It drafts from `intent`, `base` and `carried`, and is told the budget and to prefer the smallest change that delivers something.

## Out of scope

- Splitting an oversized intent into several changes: `add-change-slicing`. Until then an oversized draft is sent back to narrow itself.
- The CLI: `add-spec-cli`.

## Capabilities

- **New:** `spec/stages`.

## Impact

- New: `packages/agent/src/task/stages/proposal-md.ts`, `stages/proposal.ts`, `src/task/scripts/spec-proposal.agent`; tests.
- Depends on `add-spec-review` and `add-change-size-rules`, archived first.
