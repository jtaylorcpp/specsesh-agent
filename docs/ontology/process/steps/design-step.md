---
id: design-step
name: design
kind: step
area: process
spec:
  - "openspec/process: Design follows the proposal"
  - "openspec/process: Each forward transition follows its step"
related: [step, proposal, design, propose-step, specify-step, plan-step, change-state]
status: implemented
---

# design

Writes the change's design from its proposal alone, before any deltas exist.

## Definition

```
design: Step<{ proposal }, Design>, actor "agent"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | `{ proposal: Proposal }` | The [Proposal](../../../taxonomy/proposal.md) from `propose`, and nothing else. The input is closed: a `DesignInput` that also carries `deltas` fails the check. |
| **Output** | [Design](../../../taxonomy/design.md) | Free-form sections: context, decisions, risks. It shows what the change looks like and how it is called, with example code. |
| **Actor** | `"agent"` | |

## Invariants

- Completing it moves the change `drafting → designed`. It is the first step after `propose`, so the change is still in `drafting` when it runs.

## Relations

- Follows [propose](propose-step.md) and feeds [specify](specify-step.md), which takes `{ proposal, design, base }` and derives the requirements from the design. [plan](plan-step.md) reads the design as well.
- Second in `STEPS`: propose, design, specify, plan, validate, approve, execute, archive.
- Drives a transition of [ChangeState](../change-state.md).

## Example

`package-specsesh-agent`'s `design.md`: context, the layout after the change, decisions (one package with subpath exports, optional peers) and risks.

## Spec

- `openspec/process`: Design follows the proposal
- `openspec/process`: Each forward transition follows its step
