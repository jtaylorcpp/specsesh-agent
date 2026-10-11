---
id: specify-step
name: specify
kind: step
area: process
spec:
  - "openspec/process: Specify turns a proposal into deltas"
  - "openspec/process: Each forward transition follows its step"
related: [step, proposal, capability, delta, propose-step, design-step, change-state]
status: implemented
---

# specify

Turns a proposal into the deltas that edit the capabilities it names.

## Definition

```
specify: Step<{ proposal: Proposal, base: Capability[] }, Delta[]>, actor "agent"
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | `{ proposal: Proposal, base: Capability[] }` | The [Proposal](../../../taxonomy/proposal.md) and the current [Capability](../../../taxonomy/capability.md) specs. |
| **Output** | [Delta](../../../taxonomy/delta.md)`[]` | One or more edits per capability. |
| **Actor** | `"agent"` | |

## Invariants

- Each capability in `proposal.capabilities` SHALL receive at least one delta.
- Each `Modified` or `Removed` delta MUST name a requirement present in `base`. An output that does not fails validation.
- Completing it moves the change `drafting → specified`.

## Relations

- Follows [propose](propose-step.md); feeds [design](design-step.md).
- Drives the first transition of [ChangeState](../change-state.md).

## Example

A `Modified` delta for `["durable","cli"]` must name a requirement that exists in `openspec/specs/durable/cli/spec.md`, such as "The model collection defaults to every built-in provider plus claude-code".

## Spec

- `openspec/process`: Specify turns a proposal into deltas
- `openspec/process`: Each forward transition follows its step
