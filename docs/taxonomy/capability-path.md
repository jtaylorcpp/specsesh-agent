---
id: capability-path
name: CapabilityPath
kind: type
area: taxonomy
spec:
  - "openspec/model: A capability is a path, a purpose and its requirements"
related: [capability, root, requirement-ref, scenario-ref, proposal]
status: modelled
---

# CapabilityPath

A capability's location, as one string per directory segment under the root's `specsDir`.

## Definition

```
CapabilityPath = string[]          // non-empty; every segment non-empty
```

## Invariants

- The array is non-empty.
- Every segment is a non-empty string.

## Relations

- The `path` of a [Capability](capability.md), relative to the [Root](root.md)'s `specsDir`.
- Used by [RequirementRef](requirement-ref.md), [ScenarioRef](scenario-ref.md), every [Delta](delta.md), and the [Proposal](proposal.md)'s `capabilities.new` and `capabilities.modified`.

## Example

- `openspec/specs/durable/run-task/spec.md` has path `["durable", "run-task"]`.
- `[]` and `["durable", ""]` are not capability paths: the check fails.

## Spec

- `openspec/model`: A capability is a path, a purpose and its requirements
