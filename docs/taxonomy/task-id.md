---
id: task-id
name: TaskId
kind: type
area: taxonomy
spec:
  - "openspec/model: A task id is its group number and its position"
related: [task, task-group]
status: modelled
---

# TaskId

A task's id: its group's number, a dot, and its position.

## Definition

```
TaskId = `${group}.${n}`          // matches ^[1-9][0-9]*\.[1-9][0-9]*$
```

## Invariants

- `<group>` is the enclosing [TaskGroup](task-group.md)'s `number`; `<n>` is a positive integer.
- The id matches `^[1-9][0-9]*\.[1-9][0-9]*$`.
- A task's id starts with its own group's number.

## Relations

- The `id` of a [Task](task.md).

## Example

- `"2.4"` is task 4 of group 2.
- `"2"`, `"2.0"` and `"two.1"` fail the check.
- A task with id `"3.1"` sitting in group `2` makes the task list fail the check.

## Spec

- `openspec/model`: A task id is its group number and its position
