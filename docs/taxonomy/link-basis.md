---
id: link-basis
name: LinkBasis
kind: type
area: taxonomy
spec:
  - "openspec/model: A link records how it was inferred, strongest first"
  - "openspec/model: An exact name has confidence 1"
related: [task-link, unclaimed-scenario]
status: modelled
---

# LinkBasis

How a task link was inferred from the task's prose, ordered from strongest to weakest.

## Definition

```
LinkBasis = "scenario-named" | "requirement-named" | "capability-named" | "file-overlap" | "inferred"
```

| Basis (strongest first) | The task's text… | Confidence |
|---|---|---|
| `"scenario-named"` | holds a scenario's exact name | `1` |
| `"requirement-named"` | holds a requirement's exact name | `1` |
| `"capability-named"` | holds a capability path | below `1` |
| `"file-overlap"` | names a file another source links to the target | below `1` |
| `"inferred"` | anything weaker | below `1` |

## Invariants

- Bases are ordered as listed: comparing two links to the same target, `"scenario-named"` ranks above `"requirement-named"`, and so on down to `"inferred"`.
- `"scenario-named"` and `"requirement-named"` links have confidence `1`; all others below `1`.

## Relations

- The `basis` of a [TaskLink](task-link.md).
- Only the two exact-name bases claim scenarios; see [unclaimed scenario](unclaimed-scenario.md).

## Example

A task whose text contains `The first and second model steps are numbered 0 and 1` links to that scenario with basis `"scenario-named"`. A task that only names `packages/agentscript-durable/src/extension.ts`, a file another source links to the scenario, links with `"file-overlap"`.

## Spec

- `openspec/model`: A link records how it was inferred, strongest first
- `openspec/model`: An exact name has confidence 1
