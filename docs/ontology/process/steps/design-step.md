---
id: design-step
name: design
kind: step
area: process
spec:
  - "openspec/process: Design and plan follow the deltas"
  - "openspec/process: Each forward transition follows its step"
related: [step, proposal, delta, design, specify-step, plan-step, change-state]
status: modelled
---

# design

Writes the change's design from its proposal and deltas.

## Definition

```
design: Step<{ proposal, deltas }, Design>, actor "agent"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | `{ proposal: Proposal, deltas: Delta[] }` | The [Proposal](../../../taxonomy/proposal.md) and the [Delta](../../../taxonomy/delta.md)s from `specify`. |
| **Output** | [Design](../../../taxonomy/design.md) | Free-form sections: context, decisions, risks. |
| **Actor** | `"agent"` | |

## Invariants

- Completing it moves the change `specified → designed`.

## Relations

- Follows [specify](specify-step.md); its output is part of [plan](plan-step.md)'s input.
- Drives a transition of [ChangeState](../change-state.md).

## Example

`package-specsesh-agent`'s `design.md`: context, the layout after the change, decisions (one package with subpath exports, optional peers) and risks.

## Spec

- `openspec/process`: Design and plan follow the deltas
- `openspec/process`: Each forward transition follows its step
