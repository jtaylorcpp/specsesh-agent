---
id: group-outcome
name: GroupOutcome
kind: type
area: loops
spec:
  - "openspec/loops: The group loop drives one feature set"
  - "openspec/loops: A group outcome has one entry per task"
related: [group-loop, task-outcome, change-outcome, loop-outcome, task-id]
status: modelled
---

# GroupOutcome

A group loop's result: the group's number and one entry per task, each holding that task's latest loop outcome and how many times it ran.

## Definition

```
GroupOutcome { group: integer, tasks: { task: TaskId, outcome: LoopOutcome<TaskOutcome>, runs: integer }[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| group | `integer` | The task group's number. |
| tasks | `{ task, outcome, runs }[]` | Exactly one entry per task, in group order. |
| tasks[].task | `TaskId` | The task. |
| tasks[].outcome | `LoopOutcome<TaskOutcome>` | The task's latest loop run, whatever its status. |
| tasks[].runs | `integer` | How many times the task's loop ran (more than 1 after rework). |

## Invariants

- Exactly one entry per task, in group order, including tasks whose loop ended `"exhausted"`, `"blocked"` or `"failed"`.
- `outcome` is the latest run; earlier runs stay in their own iterations, and `runs` counts them all.

## Relations

- `Out` of the [Group loop](group-loop.md); each entry wraps a [TaskOutcome](task-outcome.md) in a [LoopOutcome](loop-outcome.md).
- Collected in [ChangeOutcome](change-outcome.md)`.groups`.

## Example

Group `2` of `baseline-agentscript-durable` converging gives `{ group: 2, tasks: [{ task: "2.1", outcome: { status: "converged", result: { task: "2.1", ticked: true }, … }, runs: 1 }, …] }`. Had task `2.4` been reopened by `"rework-task"` and converged again, its single entry would have `runs: 2` and the second run's `outcome`.

## Spec

- `openspec/loops: The group loop drives one feature set`
- `openspec/loops: A group outcome has one entry per task`
