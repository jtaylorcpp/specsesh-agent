## Why

The process ontology orders a change as propose → specify → design → plan: the design is written after the deltas and reads them. The principal works the other way round. The design comes first: what it looks like, how it is called, example code and an HTML mock. The low-level requirements are then derived from the approved design, and the tasks from both. The spec agent (`add-spec-loop` and the stage changes after it) guides a user in that order, so the ontology has to say it first.

## What Changes

- **Steps reorder to propose → design → specify → plan.**
  - `design` takes `{ proposal }`, not `{ proposal, deltas }`.
  - `specify` takes `{ proposal, design, base }`.
  - `plan` keeps `{ proposal, deltas, design }`.
  - `STEPS` lists `design` before `specify`.
- **States reorder:** the forward path becomes drafting → designed → specified → planned → validated → …
  - `design` moves `drafting → designed`;
  - `specify` moves `designed → specified`;
  - `plan` moves `specified → planned`.
- **The docs follow:** the three step pages, the state machine page, the overview and guide 06.

## Out of scope

- Design attachments (HTML mocks, example code files): `add-design-attachments`.
- Any agent or CLI. This is the ontology only.
- Changes already written in the old order stay as they are; the order is a convention of the steps, not something `openspec validate` checks.

## Capabilities

- **Modified:** `openspec/process`.

## Impact

- `packages/agent/src/openspec/process.ts` and its tests.
- `docs/ontology/process/` (four pages), `docs/overview.md`, `guides/06-openspec.md`.
- No dependency on the open changes; it can run first.
