---
id: capability
name: Capability
kind: type
area: taxonomy
spec:
  - "openspec/model: A capability is a path, a purpose and its requirements"
related: [capability-path, requirement, root, delta, requirement-ref]
status: modelled
---

# Capability

One spec: where it sits, what it is for, and the requirements it holds.

## Definition

```
Capability { path: CapabilityPath, purpose: string, requirements: Requirement[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `path` | [`CapabilityPath`](capability-path.md) | The capability's location, one segment per directory under `specsDir`. |
| `purpose` | `string` | What the capability is for (the spec's `## Purpose`). |
| `requirements` | [`Requirement`](requirement.md)`[]` | The capability's requirements, in source order. |

## Invariants

- `requirements` keep source order.

## Relations

- Located under the [Root](root.md)'s `specsDir` by its [CapabilityPath](capability-path.md).
- Holds [Requirement](requirement.md)s.
- Edited by [Delta](delta.md)s, each naming one capability.
- Pointed at by [RequirementRef](requirement-ref.md) and [ScenarioRef](scenario-ref.md) through their `capability` field.

## Example

The spec at `openspec/specs/durable/run-task/spec.md` is a capability whose `path` is `["durable", "run-task"]`.

## Spec

- `openspec/model`: A capability is a path, a purpose and its requirements
