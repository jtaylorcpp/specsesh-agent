## Why

A design that a principal can approve is more than prose: it has an HTML mock to click through, example code showing how the feature is called, sometimes a diagram. Today `Design` is only `{ sections }`, so the ontology can't say a design has those files, and the spec agent's design stage (`add-spec-design-stage`) has nowhere to record what it produced.

## What Changes

- **`Design` gains optional `attachments`**: `{ path, kind }[]`.
  - `path` is relative to the change directory and lives under `design/` (`design/mock.html`, `design/examples/start.ts`).
  - `kind` is `"mock"`, `"example"`, `"diagram"` or `"other"`.
- **A path outside `design/`, absolute, or containing `..`** fails the check.
- **The taxonomy page for Design** documents attachments.

## Out of scope

- Reading attachments from disk or parsing `design.md` into a `Design`: the ontology has no parser, by rule.
- Checking that example code compiles or a mock renders: that's the design stage's gate.
- The step order: `reorder-design-before-specs`.

## Capabilities

- **Modified:** `openspec/model`.

## Impact

- `packages/agent/src/openspec/model.ts`, its test, `docs/taxonomy/design.md`.
- Independent of every other open change.
