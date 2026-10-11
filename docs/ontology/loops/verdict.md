---
id: verdict
name: Verdict
kind: type
area: loops
spec:
  - "openspec/loops: A verdict lists satisfied and unmet targets"
  - "openspec/evidence: A passing claiming test satisfies a scenario target"
  - "openspec/evidence: A requirement target needs every scenario"
related: [iteration, target, feedback, evidence]
status: modelled
---

# Verdict

Whether an iteration's evidence meets the goal's targets, and which targets are not met and why.

## Definition

```
Verdict { met: boolean, satisfied: Target[], unmet: { target: Target, reason: string }[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| met | `boolean` | `true` exactly when `unmet` is empty. |
| satisfied | `Target[]` | The targets the evidence satisfies. |
| unmet | `{ target: Target, reason: string }[]` | The targets it does not, each with a reason. |

## Invariants

- `met` SHALL be `true` exactly when `unmet` is empty.
- A verdict SHALL be judged from the iteration's evidence only.
- Each unmet target SHALL produce at least one feedback item.

## Relations

- Judges [Target](target.md)s against [Evidence](../evidence/evidence.md).
- Part of [Iteration](iteration.md); its unmet targets become [Feedback](feedback.md).
- A met verdict ends the loop `"converged"`.

## Example

A verdict with two satisfied targets and one unmet has `met: false`. Group `2`'s check finding a scenario that group `1` converged now failing lists that scenario in `unmet`.

## Spec

- `openspec/loops: A verdict lists satisfied and unmet targets`
- `openspec/evidence: A passing claiming test satisfies a scenario target`
- `openspec/evidence: A requirement target needs every scenario`
