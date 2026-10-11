---
id: approve-step
name: approve
kind: step
area: process
spec:
  - "openspec/process: Approve is the principal's gate"
  - "openspec/process: Execution needs approval"
  - "openspec/process: A spec defect sends the change back through amendment"
related: [step, change, validation-report, approval, validate-step, execute-step, change-state]
status: modelled
---

# approve

The principal's gate: a yes or no on a validated change, before it may execute.

## Definition

```
approve: Step<{ change: Change, report: ValidationReport }, Approval>, actor "principal"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | `{ change: Change, report: ValidationReport }` | The [Change](../../../taxonomy/change.md) and its [ValidationReport](../validation-report.md). |
| **Output** | [Approval](../approval.md) = `{ approved, by: "principal", principal, notes }` | The decision, and who made it. |
| **Actor** | `"principal"` | Only the principal. |

## Invariants

- No agent or tool MAY produce an `Approval`; one whose `by` is not `"principal"` is invalid input and does not satisfy the guard.
- An `Approval` with `approved` `true` licenses `validated → approved`.
- A change returning from `amended` needs a new `Approval` before it can execute again.

## Relations

- Follows [validate](validate-step.md); licenses [execute](execute-step.md).
- Guards `validated → approved` in [ChangeState](../change-state.md).

## Example

In this repo, the principal approving `baseline-agentscript-durable` before its tests were written was this step. An agent's "looks good" in a review is [ReviewEvidence](../../evidence/review-evidence.md), never an `Approval`.

## Spec

- `openspec/process`: Approve is the principal's gate
- `openspec/process`: Execution needs approval
- `openspec/process`: A spec defect sends the change back through amendment
