---
id: action
name: Action
kind: type
area: loops
spec:
  - "openspec/loops: An iteration plans, acts, gathers evidence and judges"
related: [iteration, diff-evidence]
status: modelled
---

# Action

Something an iteration did to the workspace.

## Definition

```
Action  // fields not yet specified
```

## Invariants

- The spec names `Action` only as the element type of `Iteration.actions` ("what it did to the workspace" per the design). Its fields are **not yet specified**.

## Relations

- Element of [Iteration](iteration.md)`.actions`.
- What actions changed in files is captured separately as [DiffEvidence](../evidence/diff-evidence.md).

## Example

Not yet specifiable: the model gives `Action` no fields. An iteration that edits `packages/agentscript-pi/__tests__/cli.test.ts` records that edit in `actions`, and the changed file appears in its `DiffEvidence`.

## Spec

- `openspec/loops: An iteration plans, acts, gathers evidence and judges`
