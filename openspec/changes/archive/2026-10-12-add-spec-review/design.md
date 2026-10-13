## Context

A blocked task loop is answered by `answerEscalation`. That starts a new run of the same loop, seeded with the decision and numbering on from the blocked run's iterations, which it keeps. The spec loop answers the same way, with one extra path: an approval doesn't draft again, it records and converges.

## approvals.json

```json
{
  "approvals": [
    {
      "stage": "proposal",
      "approved": true,
      "by": "principal",
      "principal": "jesse",
      "notes": "",
      "at": "2026-10-12T17:04:11.000Z",
      "files": { "proposal.md": "9f2c…e1" }
    }
  ]
}
```

Each entry is the ontology's `Approval` (`approved`, `by: "principal"`, `principal`, `notes`) plus `stage`, `at` and `files`. It's checked with a TypeBox schema on every read. A file that fails the check refuses the start and the answer, naming `approvals.json` and the first problem.

## Answering

```ts
import { answerSpecLoop } from "@specsesh/agent/task";

// approve
const next = await answerSpecLoop(harness, id, { by: "principal", principal: "jesse", decision: "approve" }, context);
// → a new run that ends converged: { stage: "proposal", files: ["proposal.md"], approved: true }

// revise
await answerSpecLoop(harness, id, { by: "principal", principal: "jesse", decision: "Drop the CSV export; JSON only." }, context);
// → a new run whose first iteration has carried = "The principal asked for: Drop the CSV export; JSON only."
```

```
new run, input.approve = true
  approve   hash the owned files → replace this stage's entry → drop every later stage's entry
            → converged, { approved: true }          (one phase; rerunning it writes the same file)

new run, input.approve = false
  iterate … as add-spec-loop, carried = "The principal asked for: <decision>"
```

## Order between stages

```ts
const designStage: SpecStage = { name: "design", after: ["proposal"], owns: ["design.md", "design/"], … };
```

`startSpecLoop` reads `approvals.json` before creating anything. For each stage in `after`:
- no entry → refused with `the proposal stage of add-plan-export is not approved; run it and approve it first`;
- a hash that no longer matches the file → refused with `proposal.md changed since the proposal stage was approved; review it again`.

## Decisions

- **"approve" is a word, not a flag.** The answer path is the same for both outcomes, and the CLI's existing `--decision` carries it.
- **Approving drops the later approvals.** A design approved against an old proposal isn't approved against the new one. Requiring a re-review is cheaper than finding the drift during execution.
- **Hashes, not git.** The check works in a dirty tree and outside git, and doesn't care whether the principal has committed yet.

## Risks

- Approval of the same stage from two processes at once. One live process per database (`<db>.lock`) already prevents it within a database. Two databases on one change aren't guarded.
