---
id: design
name: Design
kind: type
area: taxonomy
spec:
  - "openspec/model: A design is free-form sections"
related: [change, design-step]
status: implemented
---

# Design

The change's free-form design document: headed sections in source order.

## Definition

```
Design { sections: { heading: string, body: string }[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `sections` | `{ heading, body }[]` | Each section's heading and body, in source order. |

## Invariants

- No particular headings are required. Context, decisions and risks are conventions, not fields.

## Relations

- Optional part of a [Change](change.md); absent until written.
- Produced by the [design step](../ontology/process/steps/design-step.md), a different concept with the same name.

## Example

A design whose headings are `Context`, `Two halves` and `Risks and gaps` is a valid `Design`.

## Spec

- `openspec/model`: A design is free-form sections
