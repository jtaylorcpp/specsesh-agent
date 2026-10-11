---
id: clause
name: Clause
kind: type
area: taxonomy
spec:
  - "openspec/model: A scenario is a name and ordered clauses"
  - "openspec/model: Every model type has a static type and a JSON Schema"
related: [scenario]
status: modelled
---

# Clause

One `GIVEN`, `WHEN`, `THEN` or `AND` line of a scenario.

## Definition

```
Clause { keyword: "GIVEN" | "WHEN" | "THEN" | "AND", text: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `keyword` | `"GIVEN" \| "WHEN" \| "THEN" \| "AND"` | The clause's bold keyword. |
| `text` | `string` | The text after the keyword. |

## Invariants

- `keyword` is one of the four values. Any other keyword fails both the static type and the JSON Schema.

## Relations

- Ordered within a [Scenario](scenario.md), which needs at least one `WHEN` and one `THEN`.

## Example

`{ keyword: "BUT", text: "x" }` fails the `Clause` schema, as the static type would refuse it. This is the example the model uses to show that every type's schema accepts exactly what its static type accepts.

## Spec

- `openspec/model`: A scenario is a name and ordered clauses
- `openspec/model`: Every model type has a static type and a JSON Schema
