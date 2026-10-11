---
id: delta
name: Delta
kind: type
area: taxonomy
spec:
  - "openspec/model: A delta is one of four operations on one capability"
  - "openspec/model: Removal and renaming carry their own fields"
related: [change, capability, requirement, capability-path, specify-step]
status: implemented
---

# Delta

One edit to one capability: a requirement added, modified, removed or renamed.

## Definition

```
Delta    = Added | Modified | Removed | Renamed          // discriminated by op
Added    { op: "ADDED",    capability: CapabilityPath, requirement: Requirement }
Modified { op: "MODIFIED", capability: CapabilityPath, requirement: Requirement }
Removed  { op: "REMOVED",  capability: CapabilityPath, name: string, reason: string, migration: string }
Renamed  { op: "RENAMED",  capability: CapabilityPath, from: string, to: string }
```

## Fields

| Variant | Field | Type | Meaning |
|---|---|---|---|
| all | `op` | `"ADDED" \| "MODIFIED" \| "REMOVED" \| "RENAMED"` | Which operation. |
| all | `capability` | [`CapabilityPath`](capability-path.md) | The capability edited. |
| `Added` | `requirement` | [`Requirement`](requirement.md) | The new requirement. |
| `Modified` | `requirement` | [`Requirement`](requirement.md) | The whole replacement for the requirement of the same name. |
| `Removed` | `name` | `string` | The requirement removed. |
| `Removed` | `reason` | `string` | Why it is removed. |
| `Removed` | `migration` | `string` | What replaces it. |
| `Renamed` | `from` | `string` | The old requirement name. |
| `Renamed` | `to` | `string` | The new requirement name. |

## Invariants

- A `Modified` delta replaces the whole requirement of the same `name`, scenarios included.
- A `Renamed` delta's `from` and `to` differ.

## Relations

- Part of a [Change](change.md); edits one [Capability](capability.md).
- Produced by the [specify step](../ontology/process/steps/specify-step.md).

## Example

- A `Modified` delta for `pi/cli`, applied to the base capability, replaces the requirement of the same name entirely.
- `package-specsesh-agent` removes `The bin runs the TypeScript CLI through tsx` from `pi/cli`: a `Removed` with that `name` and non-empty `reason` and `migration`.
- A `Renamed` with equal `from` and `to` fails the check.

## Spec

- `openspec/model`: A delta is one of four operations on one capability
- `openspec/model`: Removal and renaming carry their own fields
