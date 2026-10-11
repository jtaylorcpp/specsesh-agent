---
id: group-outcome
name: GroupOutcome
kind: type
area: loops
spec:
  - "openspec/loops: The group loop drives one feature set"
related: [group-loop, task-outcome, change-outcome]
status: modelled
---

# GroupOutcome

A group loop's result: the group's number and its task outcomes.

## Definition

```
GroupOutcome { group: integer, tasks: TaskOutcome[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| group | `integer` | The task group's number. |
| tasks | `TaskOutcome[]` | The outcome of each task loop the group ran. |

## Invariants

- The spec does not say whether `tasks` holds one entry per task or one per task-loop run (a reworked task runs more than once).

## Relations

- `Out` of the [Group loop](group-loop.md); holds [TaskOutcome](task-outcome.md)s.
- Collected in [ChangeOutcome](change-outcome.md)`.groups`.

## Example

Group `2` of `baseline-agentscript-durable` converging gives `{ group: 2, tasks: [{ task: "2.1", ticked: true }, …, { task: "2.5", ticked: true }] }`.

## Spec

- `openspec/loops: The group loop drives one feature set`
