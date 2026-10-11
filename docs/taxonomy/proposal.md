---
id: proposal
name: Proposal
kind: type
area: taxonomy
spec:
  - "openspec/model: A proposal states why, what, which capabilities and what not"
related: [change, capability-path, propose-step, delta]
status: modelled
---

# Proposal

Why a change exists, what it changes, which capabilities it creates or modifies, and what it leaves out.

## Definition

```
Proposal { why: string, whatChanges: string[],
           capabilities: { new: CapabilityPath[], modified: CapabilityPath[] },
           outOfScope: string[], impact: string[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `why` | `string` | The problem or opportunity. |
| `whatChanges` | `string[]` | The changes, as a list. |
| `capabilities.new` | [`CapabilityPath`](capability-path.md)`[]` | Capabilities the change creates. |
| `capabilities.modified` | [`CapabilityPath`](capability-path.md)`[]` | Existing capabilities whose requirements it changes. |
| `outOfScope` | `string[]` | What it explicitly does not do. |
| `impact` | `string[]` | What it affects. |

## Invariants

- A path does not appear in both `capabilities.new` and `capabilities.modified`.

## Relations

- Part of a [Change](change.md).
- Produced by the [propose step](../ontology/process/steps/propose-step.md).
- Its capability lists name the capabilities the change's [Delta](delta.md)s edit.

## Example

The proposal of `add-openspec-ontology` has `capabilities.new` holding `["openspec","model"]`, `["openspec","process"]`, `["openspec","loops"]` and `["openspec","evidence"]`, and `capabilities.modified` equal to `[]`. A proposal listing `["core","subset"]` in both `new` and `modified` fails the check.

## Spec

- `openspec/model`: A proposal states why, what, which capabilities and what not
