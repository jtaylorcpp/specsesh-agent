---
id: execute-step
name: execute
kind: step
area: process
spec:
  - "openspec/process: Execute runs the change loop"
  - "openspec/process: Execution needs approval"
  - "openspec/process: Archiving needs convergence and a fresh valid report"
related: [step, change, change-loop, change-outcome, loop-outcome, approve-step, archive-step, change-state]
status: modelled
---

# execute

Runs the change loop over an approved change's task list.

## Definition

```
execute: Step<Change (approved), LoopOutcome<ChangeOutcome>>, actor "loop"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | an approved [Change](../../../taxonomy/change.md) | The change, in state `approved`. |
| **Output** | [LoopOutcome](../../loops/loop-outcome.md)`<`[ChangeOutcome](../../loops/change-outcome.md)`>` | The change loop's whole outcome: its `status`, its iterations, and when converged a `result` with one entry per task group and the unclaimed scenarios. |
| **Actor** | `"loop"` | The [change loop](../../loops/change-loop.md). |

## Invariants

- A change MUST NOT enter `executing` from any state other than `approved`. `approved → executing` follows `execute` starting.
- A successful value SHALL be a `LoopOutcome<ChangeOutcome>` whose `result.groups`, when present, cover every `TaskGroup` of the change.
- An outcome with `status` `"converged"` licenses `executing → converged`. A change loop ending on a `spec-defect` finding moves the change to `amended`.

## Relations

- Licensed by [approve](approve-step.md); runs the [change loop](../../loops/change-loop.md); its outcome feeds [archive](archive-step.md).
- Drives `approved → executing`, `executing → converged` and `executing → amended` in [ChangeState](../change-state.md).

## Example

Executing `baseline-agentscript-durable` would run its three task groups as group loops. Group 1 holds the core tests, with task `1.10` as one task loop; group 3 closes the change.

## Spec

- `openspec/process`: Execute runs the change loop
- `openspec/process`: Execution needs approval
- `openspec/process`: Archiving needs convergence and a fresh valid report
