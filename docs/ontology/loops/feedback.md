---
id: feedback
name: Feedback
kind: type
area: loops
spec:
  - "openspec/loops: Feedback names a finding and an action"
  - "openspec/loops: Feedback retries inside a loop"
  - "openspec/loops: Feedback rises to the enclosing loop"
related: [finding, iteration, loop-input, escalation, task-loop, group-loop, change-loop]
status: modelled
---

# Feedback

A finding plus the action it calls for.

## Definition

```
Feedback { from: Finding, action: "retry" | "rework-task" | "add-task" | "amend-spec" | "ask" }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| from | `Finding` | The finding that prompted it. |
| action | `"retry"` · `"rework-task"` · `"add-task"` · `"amend-spec"` · `"ask"` | What it calls for. |

## Invariants

- Each unmet target of a verdict SHALL produce at least one feedback item.
- `"retry"` SHALL be carried into the next iteration of the same loop and MUST NOT leave the loop.
- `"rework-task"` reopens (unticks) a task whose evidence regressed and runs its task loop again; `"add-task"` adds a task for a target no task covered. Both are issued by a group or change check.
- `"amend-spec"` comes from a `"spec-defect"` finding and ends the change loop `"blocked"`, moving the change to `amended`.
- `"ask"` sets the loop's escalation, naming its recipient, and ends the loop `"blocked"`.

## Relations

- Rests on a [Finding](../evidence/finding.md).
- Produced by an [Iteration](iteration.md); carried down in [LoopInput](loop-input.md)`.carried`.
- `"ask"` and `"amend-spec"` produce an [Escalation](escalation.md).
- Flows inside a loop (`retry`), up to the [Group loop](group-loop.md) or [Change loop](change-loop.md) (`rework-task`, `add-task`), out of the loops (`amend-spec`), or to a principal or agent (`ask`).

## Example

Task `2.4`'s first iteration fails one CLI scenario: feedback `{ from: <code-defect finding on that scenario>, action: "retry" }` goes into iteration `2`. On 2026-10-11 the tests for `baseline-agentscript-durable` produced a `"spec-defect"` finding, which became `"amend-spec"`.

## Spec

- `openspec/loops: Feedback names a finding and an action`
- `openspec/loops: Feedback retries inside a loop`
- `openspec/loops: Feedback rises to the enclosing loop`
