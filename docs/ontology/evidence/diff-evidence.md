---
id: diff-evidence
name: DiffEvidence
kind: type
area: evidence
spec:
  - "openspec/evidence: The other evidence kinds have fixed fields"
related: [evidence, action]
status: modelled
---

# DiffEvidence

The files an iteration added, modified or deleted.

## Definition

```
DiffEvidence { kind: "diff", files: { path, change: "added" | "modified" | "deleted" }[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | `"diff"` | Discriminant. |
| files | `{ path, change }[]` | Each changed file, with `change` one of `"added"`, `"modified"`, `"deleted"`. `path`'s type is not stated in the spec. |

## Invariants

None.

## Relations

- A kind of [Evidence](evidence.md); records what an iteration's [Action](../loops/action.md)s changed.

## Example

The iteration that wrote the pi CLI tests records `{ kind: "diff", files: [{ path: "packages/agentscript-pi/__tests__/cli.test.ts", change: "added" }] }`.

## Spec

- `openspec/evidence: The other evidence kinds have fixed fields`
