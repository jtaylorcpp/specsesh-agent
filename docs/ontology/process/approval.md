---
id: approval
name: Approval
kind: type
area: process
spec:
  - "openspec/process: Approve is the principal's gate"
  - "openspec/process: Execution needs approval"
related: [approve-step, change-state, execute-step]
status: modelled
---

# Approval

The principal's yes or no on a change. Only the principal can produce one.

## Definition

```
Approval { approved: boolean, by: string, notes: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `approved` | boolean | Whether the change is approved. |
| `by` | string | Who approved it. |
| `notes` | string | Anything the approver said. |

## Invariants

- No agent or tool MAY produce an `Approval`.
- An `Approval` recorded with an agent as `by` SHALL NOT satisfy the approval guard.
- `validated → approved` needs an `Approval` with `approved` `true` from the principal.
- After an amendment, the change needs a new `Approval` before it can execute again.

## Relations

- Output of [approve](steps/approve-step.md).
- Guards the `validated → approved` transition of [ChangeState](change-state.md), and so [execute](steps/execute-step.md).

## Example

`{ approved: true, by: "principal", notes: "go" }` licenses a validated change to move to `approved`. The same shape with an agent as `by` licenses nothing.

## Spec

- `openspec/process`: Approve is the principal's gate
- `openspec/process`: Execution needs approval
