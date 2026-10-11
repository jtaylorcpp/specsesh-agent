---
id: capability-index
name: CapabilityIndex
kind: type
area: process
spec:
  - "openspec/process: Propose turns intent into a proposal"
related: [intent, propose-step, capability, capability-path]
status: implemented
---

# CapabilityIndex

The list of every capability that already exists, each with its purpose, so a proposal can reuse existing paths.

## Definition

```
CapabilityIndex = { path: CapabilityPath, purpose: string }[]
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `path` | [CapabilityPath](../../taxonomy/capability-path.md) | An existing capability's path. |
| `purpose` | string | That capability's purpose. |

## Invariants

- It SHALL list every existing `CapabilityPath` with its `purpose`.

## Relations

- The `existing` field of an [Intent](intent.md).
- Each entry summarises a [Capability](../../taxonomy/capability.md).

## Example

In this repo it lists, among others, `{ path: ["durable","cli"], purpose: "The agentscript-durable command: run a script durably on a Node SQLite database, ..." }`.

## Spec

- `openspec/process`: Propose turns intent into a proposal
