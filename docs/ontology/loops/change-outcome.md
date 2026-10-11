---
id: change-outcome
name: ChangeOutcome
kind: type
area: loops
spec:
  - "openspec/loops: The change loop reports its groups and what was unclaimed"
related: [change-loop, group-outcome, scenario-ref, unclaimed-scenario, archive-step]
status: modelled
---

# ChangeOutcome

The change loop's result: its group outcomes, and the scenarios no task claimed when execution started.

## Definition

```
ChangeOutcome { groups: GroupOutcome[], unclaimed: ScenarioRef[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| groups | `GroupOutcome[]` | The outcome of each group loop. |
| unclaimed | `ScenarioRef[]` | The scenarios no task claimed at the start of execution. |

## Invariants

- `unclaimed` SHALL list the scenarios no task claimed at the start of execution, even after the change check added tasks for them.

## Relations

- `Out` of the [Change loop](change-loop.md); holds [GroupOutcome](group-outcome.md)s and [ScenarioRef](../../taxonomy/scenario-ref.md)s of [unclaimed scenarios](../../taxonomy/unclaimed-scenario.md).
- A converged one is the input the [archive](../process/steps/archive-step.md) step needs.

## Example

A change loop that converges after adding tasks for two unclaimed scenarios returns `unclaimed` listing those two scenarios.

## Spec

- `openspec/loops: The change loop reports its groups and what was unclaimed`
