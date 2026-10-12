---
id: specify-step
name: specify
kind: step
area: process
spec:
  - "openspec/process: Specify turns a proposal into deltas"
  - "openspec/process: Each forward transition follows its step"
related: [step, proposal, design, capability, delta, design-step, plan-step, change-state]
status: implemented
---

# specify

Turns a proposal and its approved design into the deltas that edit the capabilities it names.

## Definition

```
specify: Step<{ proposal: Proposal, design: Design, base: Capability[] }, Delta[]>, actor "agent"

SpecifyInput = closed({ proposal: Proposal, design: Design, base: Type.Array(Capability) })
```

## Fields

| | Type | Meaning |
|---|---|---|
| **Input** | `{ proposal: Proposal, design: Design, base: Capability[] }` | The [Proposal](../../../taxonomy/proposal.md), its approved [Design](../../../taxonomy/design.md), and the current [Capability](../../../taxonomy/capability.md) specs. |
| **Output** | [Delta](../../../taxonomy/delta.md)`[]` | One or more edits per capability. |
| **Actor** | `"agent"` | |

## Invariants

- Each capability in `proposal.capabilities` SHALL receive at least one delta.
- Each `Modified` or `Removed` delta MUST name a requirement present in `base`. An output that does not fails validation.
- `design` is required: a `SpecifyInput` without it fails the check.
- Completing it moves the change `designed → specified`. Running it on a change still in `drafting` is refused.

## Why it takes the design

The requirements are derived from the approved design, so everything the design shows is either pinned by a requirement or listed out of scope. Without the design, specify could only guess at what the change builds.

## Relations

- Follows [design](design-step.md); feeds [plan](plan-step.md). Lifecycle order: propose → design → specify → plan.
- Drives the `designed → specified` transition of [ChangeState](../change-state.md).

## Example

A `Modified` delta for `["durable","cli"]` must name a requirement that exists in `openspec/specs/durable/cli/spec.md`, such as "The model collection defaults to every built-in provider plus claude-code".

## Spec

- `openspec/process`: Specify turns a proposal into deltas
- `openspec/process`: Each forward transition follows its step
