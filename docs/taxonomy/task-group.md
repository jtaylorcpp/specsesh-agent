---
id: task-group
name: TaskGroup
kind: type
area: taxonomy
spec:
  - "openspec/model: A task list is numbered groups of tasks"
  - "openspec/model: A task id is its group number and its position"
related: [task-list, task, task-id, group-loop]
status: modelled
---

# TaskGroup

A numbered section of the task list, one feature set, read from a `## <number>. <title>` heading.

## Definition

```
TaskGroup { number: integer, title: string, tasks: Task[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `number` | `integer` | The group's number, from the heading. |
| `title` | `string` | The heading text after `<number>. `. |
| `tasks` | [`Task`](task.md)`[]` | The group's tasks, in source order. |

## Invariants

- `number` is positive, and unique and ascending across the [TaskList](task-list.md).
- Every task's [TaskId](task-id.md) starts with this group's `number`.

## Relations

- Part of a [TaskList](task-list.md); holds [Task](task.md)s.
- Driven by a [group loop](../ontology/loops/group-loop.md).

## Example

The heading `## 2. Durable: tests for scenarios with none today` in `baseline-agentscript-durable`'s tasks.md is the group `{ number: 2, title: "Durable: tests for scenarios with none today", tasks }`.

## Spec

- `openspec/model`: A task list is numbered groups of tasks
- `openspec/model`: A task id is its group number and its position
