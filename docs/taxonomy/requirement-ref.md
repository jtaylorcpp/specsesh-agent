---
id: requirement-ref
name: RequirementRef
kind: type
area: taxonomy
spec:
  - "openspec/model: A task link targets a requirement or a scenario"
  - "openspec/model: References serialise to one line of text"
related: [requirement, capability-path, scenario-ref, task-link, target, context-ref]
status: modelled
---

# RequirementRef

A pointer to one requirement: its capability path and its name.

## Definition

```
RequirementRef { capability: CapabilityPath, requirement: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `capability` | [`CapabilityPath`](capability-path.md) | The capability holding the requirement. |
| `requirement` | `string` | The requirement's `name`. |

## Invariants

- As text it is `<path> › <requirement>`, with ` › ` (space, U+203A, space) as the separator: `durable/run-task › The step number is the index of the step being run`. Parsing the text gives back the same reference.

## Relations

- Points at a [Requirement](requirement.md).
- A possible `target` of a [TaskLink](task-link.md), and one form of a loop's [Target](../ontology/loops/target.md).
- [ScenarioRef](scenario-ref.md) extends it with a scenario name.

## Example

`{ capability: ["durable","run-task"], requirement: "The step number is the index of the step being run" }`

## Spec

- `openspec/model`: A task link targets a requirement or a scenario
- `openspec/model`: References serialise to one line of text
