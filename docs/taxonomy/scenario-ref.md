---
id: scenario-ref
name: ScenarioRef
kind: type
area: taxonomy
spec:
  - "openspec/model: A task link targets a requirement or a scenario"
  - "openspec/model: References serialise to one line of text"
related: [scenario, requirement-ref, task-link, unclaimed-scenario, target, test-evidence, context-ref]
status: implemented
---

# ScenarioRef

A pointer to one scenario: its capability path, its requirement's name and its own name.

## Definition

```
ScenarioRef { capability: CapabilityPath, requirement: string, scenario: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `capability` | [`CapabilityPath`](capability-path.md) | The capability holding the scenario. |
| `requirement` | `string` | The enclosing requirement's `name`. |
| `scenario` | `string` | The scenario's `name`. |

## Invariants

- As text it is `<path> › <requirement> › <scenario>`, with ` › ` (space, U+203A, space) as the separator: `durable/run-task › The step number is the index of the step being run › The first and second model steps are numbered 0 and 1`. Parsing the text gives back the same reference.

## Relations

- Points at a [Scenario](scenario.md); a [RequirementRef](requirement-ref.md) plus a scenario name.
- A possible `target` of a [TaskLink](task-link.md), and one form of a loop's [Target](../ontology/loops/target.md).
- The `scenario` field of [TestEvidence](../ontology/evidence/test-evidence.md).
- An [unclaimed scenario](unclaimed-scenario.md) is a ScenarioRef.

## Example

`{ capability: ["durable","run-task"], requirement: "The step number is the index of the step being run", scenario: "The first and second model steps are numbered 0 and 1" }`

## Spec

- `openspec/model`: A task link targets a requirement or a scenario
- `openspec/model`: References serialise to one line of text
