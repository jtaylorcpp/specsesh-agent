---
id: change-outcome
name: ChangeOutcome
kind: type
area: loops
spec:
  - "openspec/loops: The change loop reports its groups and what was unclaimed"
related: [change-loop, group-outcome, scenario-ref, unclaimed-scenario, archive-step, loop-outcome, execute-step]
status: modelled
---

# ChangeOutcome

The change loop's result: its group outcomes, and the scenarios no task claimed when execution started.

## Definition

```
ChangeOutcome { groups: { group: integer, outcome: LoopOutcome<GroupOutcome>, runs: integer }[], unclaimed: ScenarioRef[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| groups | `{ group, outcome, runs }[]` | Exactly one entry per task group, in order. |
| groups[].group | `integer` | The group's number. |
| groups[].outcome | `LoopOutcome<GroupOutcome>` | The group's latest loop run, whatever its status. |
| groups[].runs | `integer` | How many times the group's loop ran. |
| unclaimed | `ScenarioRef[]` | The scenarios no task claimed at the start of execution. |

## Invariants

- One entry per task group, in order; `outcome` is the latest run and `runs` counts them all.
- `ChangeOutcome` is the `result` of the change loop; [execute](../process/steps/execute-step.md) returns the whole `LoopOutcome<ChangeOutcome>`, whose `status` is what the archive guard reads.
- `unclaimed` SHALL list the scenarios no task claimed at the start of execution, even after the change check added tasks for them.

## Relations

- `Out` of the [Change loop](change-loop.md); each entry wraps a [GroupOutcome](group-outcome.md) in a [LoopOutcome](loop-outcome.md); holds and [ScenarioRef](../../taxonomy/scenario-ref.md)s of [unclaimed scenarios](../../taxonomy/unclaimed-scenario.md).
- A `LoopOutcome<ChangeOutcome>` with `status` `"converged"` is the input the [archive](../process/steps/archive-step.md) step needs.

## Example

A change loop that converges after adding tasks for two unclaimed scenarios returns `unclaimed` listing those two scenarios.

## Spec

- `openspec/loops: The change loop reports its groups and what was unclaimed`
