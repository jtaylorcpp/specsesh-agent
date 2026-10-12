## Why

`add-spec-loop` stops every stage at a review. Nothing can answer it yet, so a draft can be produced but never approved, and there's no record of what the principal approved. The guided flow needs the principal to say "approve" and have the next stage open, or to say what to change and get a new draft. It also needs a later stage to notice when an earlier, approved file has been changed since.

## What Changes

- **`answerSpecLoop(harness, id, { by, principal, decision })`.** As every answer in this package does, it starts a new run of the blocked loop.
  - `approve` (trimmed, any case) on a review ends the new run `converged` with `approved: true`, writing no draft.
  - Any other decision on a review is a revision. It's carried into the next draft as "The principal asked for: …", and iterations number on from the earlier run.
  - The answer to a question is carried the same way, even if it is the word "approve".
- **`approvals.json`** in the change directory records each approval:
  - `stage`, `principal`, `notes` and `at`;
  - a sha256 for each file the stage owns.

  Approving a stage drops the approvals of every stage after it, since they were approved against the old text.
- **`SpecStage.after`** names the stages that must be approved first. `startSpecLoop` refuses when one isn't approved, or when one of its files has changed since its approval, naming the file and the stage to review again.
- **Only the principal approves.** An approve answer `by: "agent"` is refused, as the ontology's `Approval` requires.

## Out of scope

- The CLI (`pnpm task answer` routing to spec loops): `add-spec-cli`.
- Committing `approvals.json`. The runner never commits, and the principal commits with the stage's files.

## Capabilities

- **Modified:** `spec/loop`.

## Impact

- New: `packages/agent/src/task/spec-approvals.ts`, `spec-answer.ts`. Updated: `spec-loop.ts` (an `approve` phase), `spec-api.ts` (the `after` check), `spec-stage.ts`.
- Depends on `add-spec-loop`, archived first.
