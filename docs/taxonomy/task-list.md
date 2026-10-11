---
id: task-list
name: TaskList
kind: type
area: taxonomy
spec:
  - "openspec/model: A task list is numbered groups of tasks"
related: [task-group, task, change, plan-step, change-loop]
status: implemented
---

# TaskList

The change's task list (`tasks.md`): numbered groups of tasks, in order.

## Definition

```
TaskList { groups: TaskGroup[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `groups` | [`TaskGroup`](task-group.md)`[]` | The numbered groups, in source order. |

## Invariants

- Group numbers are positive, unique and ascending in source order.

## Relations

- Optional part of a [Change](change.md); absent until written.
- Produced by the [plan step](../ontology/process/steps/plan-step.md).
- Driven by the [change loop](../ontology/loops/change-loop.md), which runs one group loop per [TaskGroup](task-group.md).

## Example

`baseline-agentscript-durable`'s tasks.md has groups `1` (core tests), `2` (durable tests) and `3` (close).

## Spec

- `openspec/model`: A task list is numbered groups of tasks
