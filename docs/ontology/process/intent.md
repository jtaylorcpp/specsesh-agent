---
id: intent
name: Intent
kind: type
area: process
spec:
  - "openspec/process: Propose turns intent into a proposal"
related: [propose-step, capability-index, proposal]
status: modelled
---

# Intent

The input to `propose`: the principal's own words, plus the index of capabilities that already exist.

## Definition

```
Intent { words: string, existing: CapabilityIndex }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `words` | string | What the principal asked for, in their words. The agent drafts from these. |
| `existing` | [CapabilityIndex](capability-index.md) | Every existing capability path with its purpose. |

## Invariants

- The proposal drafted from it reuses existing capability paths listed in `existing`, not near-duplicates.

## Relations

- Input to [propose](steps/propose-step.md), whose output is a [Proposal](../../taxonomy/proposal.md).
- `existing` is a [CapabilityIndex](capability-index.md).

## Example

`{ words: "make it load from my claude subscription as an option", existing: [..., { path: ["pi","claude-code"], purpose }, ...] }`.

## Spec

- `openspec/process`: Propose turns intent into a proposal
