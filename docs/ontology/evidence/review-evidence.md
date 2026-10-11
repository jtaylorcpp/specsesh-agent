---
id: review-evidence
name: ReviewEvidence
kind: type
area: evidence
spec:
  - "openspec/evidence: The other evidence kinds have fixed fields"
related: [evidence]
status: implemented
---

# ReviewEvidence

An agent's or the principal's review verdict.

## Definition

```
ReviewEvidence { kind: "review", reviewer: "agent" | "principal", verdict: "approve" | "changes", notes: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | `"review"` | Discriminant. |
| reviewer | `"agent"` · `"principal"` | Who reviewed. |
| verdict | `"approve"` · `"changes"` | The review's verdict. |
| notes | `string` | The reviewer's notes. |

## Invariants

None.

## Relations

- A kind of [Evidence](evidence.md).

## Example

The orchestrator reviewing a test agent's diff before merging it records `{ kind: "review", reviewer: "agent", verdict: "approve", notes: "…" }`.

## Spec

- `openspec/evidence: The other evidence kinds have fixed fields`
