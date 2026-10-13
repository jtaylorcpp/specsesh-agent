## Why

With the proposal and design approved, the requirements can be derived: low-level, testable, everything the design shows either pinned or explicitly out of scope. This step is mechanical enough to get wrong in mechanical ways. A MODIFIED block that doesn't copy every scenario, a requirement over 500 characters, a new capability without a Purpose, a delta for a capability the proposal never named. OpenSpec catches some of these and our size budget others. The specs stage runs both as its gate, so the user only ever reviews deltas that already validate strictly and fit the budget.

## What Changes

- **`specsStage`** (`./task`):
  - owns `specs/`, and follows `design`;
  - its bundled script is `spec-specify.agent`;
  - it seeds `approved` with the proposal and the whole design (including the mock and examples), and `base` with the full spec of each modified capability, since a MODIFIED block must copy its requirement whole.
- **The gate:**
  - `openspec validate <change> --strict --json`, with each reported issue at its own level;
  - the deltas cover exactly the proposal's capabilities, and a new capability's delta has a `## Purpose`;
  - the requirements, scenarios and capabilities limits from `openspec/size`, counted from `openspec show <change> --json --deltas-only`.
- **`SPEC_STAGES`** becomes `[proposalStage, designStage, specsStage]`.

## Out of scope

- The tasks stage: `add-spec-plan-stage`.
- Trial-folding the change into the specs (`pnpm spec:archive`'s check). The open changes show a delta can legitimately depend on an unarchived change, so a fold failure isn't a draft defect.

## Capabilities

- **Modified:** `spec/stages`.

## Impact

- New: `packages/agent/src/task/stages/specs.ts`, `stages/openspec-cli.ts`, `src/task/scripts/spec-specify.agent`.
- The gate needs `openspec` on `PATH`. Under `pnpm task` it's there when the repo depends on `@fission-ai/openspec`, as this one does.
- Depends on `add-spec-design-stage`, archived first.
