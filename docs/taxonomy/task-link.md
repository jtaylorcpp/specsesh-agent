---
id: task-link
name: TaskLink
kind: type
area: taxonomy
spec:
  - "openspec/model: A task link targets a requirement or a scenario"
  - "openspec/model: An exact name has confidence 1"
related: [task, requirement-ref, scenario-ref, link-basis, unclaimed-scenario]
status: modelled
---

# TaskLink

An inferred link from a task to a requirement or scenario it serves, recording how it was found and how sure it is.

## Definition

```
TaskLink { target: RequirementRef | ScenarioRef, basis: LinkBasis, confidence: number }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `target` | [`RequirementRef`](requirement-ref.md) \| [`ScenarioRef`](scenario-ref.md) | What the task serves. |
| `basis` | [`LinkBasis`](link-basis.md) | How the link was inferred from the task's prose. |
| `confidence` | `number` | How sure the link is, in `[0, 1]`. |

## Invariants

- `confidence` lies in `[0, 1]`.
- A link whose `basis` is `"scenario-named"` or `"requirement-named"` has `confidence` `1`.
- A link with any other basis has `confidence` below `1`.

## Relations

- One of a [Task](task.md)'s `links`.
- Only `"scenario-named"` and `"requirement-named"` links claim scenarios; a delta scenario no such link reaches is an [unclaimed scenario](unclaimed-scenario.md).

## Example

A task naming `Scenario: The first and second model steps are numbered 0 and 1` links to the `ScenarioRef` with `capability` `["durable","run-task"]`, `requirement` `The step number is the index of the step being run` and that `scenario`, with basis `"scenario-named"` and confidence `1`. These links fail the check:
- `confidence` `1.5`;
- basis `"file-overlap"` with `confidence` `1`;
- basis `"scenario-named"` with `confidence` `0.8`.

## Spec

- `openspec/model`: A task link targets a requirement or a scenario
- `openspec/model`: An exact name has confidence 1
