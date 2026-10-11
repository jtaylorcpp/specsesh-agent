---
id: archive-result
name: ArchiveResult
kind: type
area: process
spec:
  - "openspec/process: Archive folds a converged change, guarded"
related: [archive-step, capability-path, change-state]
status: implemented
---

# ArchiveResult

What archiving a converged change produced: where it went, and what it folded into the specs.

## Definition

```
ArchiveResult { archivedAs: string, totals: { added, modified, removed, renamed: integer }, specsUpdated: CapabilityPath[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `archivedAs` | string | The archived change's name. |
| `totals.added` | integer | Requirements added to the specs. |
| `totals.modified` | integer | Requirements modified. |
| `totals.removed` | integer | Requirements removed. |
| `totals.renamed` | integer | Requirements renamed. |
| `specsUpdated` | [CapabilityPath](../../taxonomy/capability-path.md)`[]` | The capabilities whose specs changed. |

## Invariants

- Produced only from a change whose outcome is `"converged"` (see [archive](steps/archive-step.md)).

## Relations

- Output of [archive](steps/archive-step.md).
- Its production moves the change from `converged` to `archived` in [ChangeState](change-state.md).

## Example

`baseline-agentscript-durable`, archived on 2026-10-11:

```
{ archivedAs: "2026-10-11-baseline-agentscript-durable",
  totals: { added: 140, modified: 0, removed: 0, renamed: 0 },
  specsUpdated: [ ["core","authoring"], ["core","composition"], ["core","reasoning-port"], ["core","step-machine"],
                  ["core","subset"], ["durable","cli"], ["durable","cloudflare"], ["durable","host"], ["durable","run-task"] ] }
```

## Spec

- `openspec/process`: Archive folds a converged change, guarded
