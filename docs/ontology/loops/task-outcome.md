---
id: task-outcome
name: TaskOutcome
kind: type
area: loops
spec:
  - "openspec/loops: The task loop drives one task to its targets"
  - "openspec/loops: Only a converged task loop ticks its box"
related: [task-loop, task-id, group-outcome]
status: modelled
---

# TaskOutcome

A task loop's result: which task, and whether its box was ticked.

## Definition

```
TaskOutcome { task: TaskId, ticked: boolean }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| task | `TaskId` | The task the loop drove. |
| ticked | `boolean` | Whether the box is ticked in tasks.md. |

## Invariants

- `ticked` SHALL be `true` when the task loop ends `"converged"`; a box is never ticked otherwise.
- The spec does not say whether a `TaskOutcome` exists for a loop that did not converge (`LoopOutcome.result` is required only when converged).

## Relations

- `Out` of the [Task loop](task-loop.md); names a [TaskId](../../taxonomy/task-id.md).
- Collected in [GroupOutcome](group-outcome.md)`.tasks`.

## Example

Task `2.4`'s loop converging gives `{ task: "2.4", ticked: true }`.

## Spec

- `openspec/loops: The task loop drives one task to its targets`
- `openspec/loops: Only a converged task loop ticks its box`
