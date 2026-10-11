---
id: group-loop
name: Group loop
kind: loop
area: loops
spec:
  - "openspec/loops: The group loop drives one feature set"
  - "openspec/loops: Feedback rises to the enclosing loop"
related: [loop, task-group, task-loop, group-outcome, change-loop]
status: modelled
---

# Group loop

The loop that drives one task group, a feature set: its task loops in order, then a group check.

## Definition

```
Loop<TaskGroup, GroupOutcome>
  goal:    one TaskGroup
  targets: every target its tasks link to
           + no regression in targets earlier groups converged
  iterates: its task loops, in order, then a group check
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| Goal | `TaskGroup` | One numbered section of tasks.md. |
| Targets | its tasks' targets + no regression | Earlier groups' converged targets must still hold. |
| Out | `GroupOutcome` | `{ group: integer, tasks: TaskOutcome[] }`. |

## Invariants

- It SHALL run its task loops in order, then a group check.
- A target an earlier group converged that now fails SHALL appear as unmet in this group's verdict.
- Its check MAY issue `"rework-task"` (reopen a task whose evidence regressed) or `"add-task"` (a target no task covered), then run the task loop for that task.

## Relations

- An instance of [Loop](loop.md) over one [TaskGroup](../../taxonomy/task-group.md).
- Runs [Task loop](task-loop.md)s and receives their outcomes when they end exhausted or blocked.
- Returns a [GroupOutcome](group-outcome.md); run in order by the [Change loop](change-loop.md).

## Example

Group `1` converged with scenario S passing. When group `2`'s check finds S failing, group `2`'s verdict lists S as unmet. If group `2`'s check finds a target none of its tasks links to, it issues `"add-task"` and runs a task loop for the new task.

## Spec

- `openspec/loops: The group loop drives one feature set`
- `openspec/loops: Feedback rises to the enclosing loop`
