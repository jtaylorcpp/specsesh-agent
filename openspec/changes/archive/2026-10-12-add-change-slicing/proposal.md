## Why

The principal wants users steered toward several small changes rather than one medium or large one. After `add-spec-proposal-stage`, an oversized draft is only sent back to narrow itself, so whatever the user asked for beyond two capabilities is quietly dropped. The agent should instead split the intent into an ordered series of small changes, draft the first one, and leave the rest written down for the user to start next, each with its own intent.

## What Changes

- **The proposal stage also owns `slices.md`**: an ordered list, one line per change, `` 1. `<change-id>`: <intent> ``.
- **When a draft is over the capability budget,** the size warning tells the script to slice. The gate is met by a `slices.md` that:
  - has at least two entries;
  - starts with this change's own id;
  - names only new, kebab-case ids;
  - comes with a `proposal.md` that is within budget for the first slice alone.
- **`spec-proposal.agent`** learns to slice: by capability first, then by what a user can see delivered, in dependency order.
- **Approving a sliced proposal** prints a `spec` command for each remaining slice, carrying its intent and the slice it follows.

## Out of scope

- Creating the later slices automatically. The principal starts each one; the printed commands make that one paste.
- Re-slicing after approval. Editing `slices.md` by hand is allowed, and it's re-checked if the proposal stage runs again.

## Capabilities

- **Modified:** `spec/stages`, `task/cli`.

## Impact

- New: `packages/agent/src/task/stages/slices-md.ts`. Updated: `stages/proposal.ts`, `scripts/spec-proposal.agent`, `spec-cli.ts`.
- Depends on `add-spec-cli-events`, archived first.
