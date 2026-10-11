---
id: budget
name: Budget
kind: type
area: loops
spec:
  - "openspec/loops: A loop input carries the goal, context, budget and carried feedback"
  - "openspec/loops: Each status has one cause"
related: [loop-input, loop-outcome]
status: implemented
---

# Budget

How many iterations, and optionally how much wall time, a loop run may take.

## Definition

```
Budget { maxIterations: integer, maxWallMs?: integer }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| maxIterations | `integer` | The most iterations the run may take. At least `1`. |
| maxWallMs | `integer`, optional | A wall-clock limit in milliseconds. |

## Invariants

- `maxIterations` SHALL be at least `1`.
- A loop SHALL end `"exhausted"` when `maxIterations` iterations ran with targets unmet.

## Relations

- Part of [LoopInput](loop-input.md).
- Running out of it ends the loop `"exhausted"` ([LoopOutcome](loop-outcome.md)).

## Example

`{ maxIterations: 3 }`: if the third iteration's verdict is not met and no feedback asks or amends, the loop ends `"exhausted"` with three iterations. `{ maxIterations: 0 }` fails its check.

## Spec

- `openspec/loops: A loop input carries the goal, context, budget and carried feedback`
- `openspec/loops: Each status has one cause`
