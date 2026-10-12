## Why

The principal's order is proposal, then design, then specs, then tasks. The design is where a feature becomes concrete enough to approve: how it looks, an HTML mock to click through, and example code showing how it is called. The requirements are derived from that approved design afterwards. The spec loop has a proposal stage; this change adds the design stage, with a gate that insists on the mock and the examples rather than prose alone.

## What Changes

- **`designStage`** (`./task`):
  - owns `design.md` and `design/`, and follows `proposal`;
  - its bundled script is `spec-design.agent`;
  - it seeds `approved` with `proposal.md`, and `base` with the full current spec of every capability the proposal modifies.
- **The gate:**
  - `design.md` has at least two `## ` sections;
  - at least one HTML mock under `design/`, a complete document (`<!doctype html>` through `</html>`) that loads nothing from the network;
  - at least one file under `design/examples/`;
  - every `design/…` path `design.md` names exists.
- **`SPEC_STAGES`** becomes `[proposalStage, designStage]`.
- **`spec-design.agent`** drafts all three kinds of file in one bundle:
  - a UI mock shows every state the proposal names;
  - a CLI or library mock shows a rendered session or flow;
  - examples are the calls a user would write.

## Out of scope

- Type-checking or running the examples. That needs a per-repo command; it's parked as a follow-up.
- Publishing the mock anywhere. It's a file in the change, which the principal opens locally.

## Capabilities

- **Modified:** `spec/stages`.

## Impact

- New: `packages/agent/src/task/stages/design.ts`, `src/task/scripts/spec-design.agent`. Updated: `spec-stages.ts`, `options.ts`.
- Depends on `add-change-slicing` and `add-design-attachments`, archived first.
