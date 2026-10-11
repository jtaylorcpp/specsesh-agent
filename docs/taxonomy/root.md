---
id: root
name: Root
kind: type
area: taxonomy
spec:
  - "openspec/model: Root locates a planning home"
related: [capability, change, capability-path]
status: implemented
---

# Root

Where a project's main specs and its changes live, and which OpenSpec workflow schema the project uses.

## Definition

```
Root { specsDir: string, changesDir: string, schema: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `specsDir` | `string` | The directory holding the main specs. |
| `changesDir` | `string` | The directory holding in-flight and archived changes. |
| `schema` | `string` | The name of the OpenSpec workflow schema in use. |

## Invariants

None.

## Relations

- [Capability](capability.md) paths are directory segments under `specsDir` (see [CapabilityPath](capability-path.md)).
- Every [Change](change.md) lives under `changesDir`.

## Example

This repository's root:

```
{ specsDir: "openspec/specs", changesDir: "openspec/changes", schema: "spec-driven" }
```

## Spec

- `openspec/model`: Root locates a planning home
