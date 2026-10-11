---
id: requirement
name: Requirement
kind: type
area: taxonomy
spec:
  - "openspec/model: A requirement is a name, normative text and its scenarios"
related: [scenario, capability, requirement-ref, delta]
status: modelled
---

# Requirement

A named, normative statement of behaviour, with the scenarios that make it testable.

## Definition

```
Requirement { name: string, text: string, scenarios: Scenario[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | The text after `### Requirement: `. |
| `text` | `string` | The body before the first scenario. |
| `scenarios` | [`Scenario`](scenario.md)`[]` | The requirement's scenarios, in source order. |

## Invariants

- `text` contains `SHALL` or `MUST`.
- `scenarios` is non-empty and keeps source order.

## Relations

- Belongs to a [Capability](capability.md).
- Holds [Scenario](scenario.md)s.
- Carried whole by an `Added` or `Modified` [Delta](delta.md); named by `Removed` and `Renamed`.
- Pointed at by a [RequirementRef](requirement-ref.md).

## Example

`{ name: "x", text: "The system SHALL x.", scenarios: [] }` is not a requirement: it has no scenario. A requirement whose `text` has neither `SHALL` nor `MUST` also fails the check.

## Spec

- `openspec/model`: A requirement is a name, normative text and its scenarios
