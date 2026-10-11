---
id: propose-step
name: propose
kind: step
area: process
spec:
  - "openspec/process: Propose turns intent into a proposal"
related: [step, intent, capability-index, proposal, specify-step, change-state]
status: modelled
---

# propose

The first step: an agent drafts a proposal from the principal's words and the existing capabilities.

## Definition

```
propose: Step<Intent, Proposal>, actor "agent"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | [Intent](../intent.md) = `{ words, existing: CapabilityIndex }` | The principal's words and every existing capability with its purpose. |
| **Output** | [Proposal](../../../taxonomy/proposal.md) | Why, what changes, which capabilities, what is out of scope. |
| **Actor** | `"agent"` | Drafting from the principal's `words`. Its first `Proposal` creates the change in state `"drafting"`. |

## Invariants

- The proposal reuses existing capability paths from `existing` rather than introducing near-duplicates.

## Relations

- Its input is an [Intent](../intent.md), carrying a [CapabilityIndex](../capability-index.md).
- Its output feeds [specify](specify-step.md).

## Example

Given an `Intent` whose `existing` lists `["durable","cli"]`, a proposal that modifies the durable CLI puts `["durable","cli"]` in `capabilities.modified`, not a new path such as `["durable","command"]`.

## Spec

- `openspec/process`: Propose turns intent into a proposal
