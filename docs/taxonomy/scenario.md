---
id: scenario
name: Scenario
kind: type
area: taxonomy
spec:
  - "openspec/model: A scenario is a name and ordered clauses"
related: [clause, requirement, scenario-ref, unclaimed-scenario, test-evidence]
status: implemented
---

# Scenario

A named, testable example of a requirement, written as ordered clauses.

## Definition

```
Scenario { name: string, clauses: Clause[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | The text after `#### Scenario: `. |
| `clauses` | [`Clause`](clause.md)`[]` | The scenario's GIVEN, WHEN, THEN and AND lines, in source order. |

## Invariants

- `clauses` is non-empty and keeps source order.
- `clauses` contains at least one `WHEN` and at least one `THEN`.

## Relations

- Belongs to a [Requirement](requirement.md).
- Made of [Clause](clause.md)s.
- Pointed at by a [ScenarioRef](scenario-ref.md).
- Satisfied by passing [TestEvidence](../ontology/evidence/test-evidence.md) whose test is named after it.
- A delta scenario no task claims is an [unclaimed scenario](unclaimed-scenario.md).

## Example

The scenario `The first and second model steps are numbered 0 and 1` in `durable/run-task` has one `WHEN` clause followed by one `THEN` clause, each holding the text after its bold keyword. A scenario whose clauses are only `GIVEN` and `WHEN` fails the check.

## Spec

- `openspec/model`: A scenario is a name and ordered clauses
