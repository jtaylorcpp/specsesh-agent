---
id: change
name: Change
kind: type
area: taxonomy
spec:
  - "openspec/model: A change gathers its artifacts and its state"
  - "openspec/model: Every model type has a static type and a JSON Schema"
related: [proposal, delta, design, task-list, change-state, root]
status: modelled
---

# Change

A unit of work: its proposal, its deltas, its optional design and task list, and the state it is in.

## Definition

```
Change { id: string, schema: string, proposal: Proposal, deltas: Delta[],
         design?: Design, tasks?: TaskList, state: ChangeState }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | The change's name; kebab-case. |
| `schema` | `string` | The OpenSpec workflow schema it uses. |
| `proposal` | [`Proposal`](proposal.md) | Why the change exists and what it touches. |
| `deltas` | [`Delta`](delta.md)`[]` | Its edits to capabilities. |
| `design` | [`Design`](design.md), optional | Absent until written. |
| `tasks` | [`TaskList`](task-list.md), optional | Absent until written. |
| `state` | [`ChangeState`](../ontology/process/change-state.md) | Where the change is in its lifecycle; defined by `openspec/process`. |

## Invariants

- `id` is kebab-case.
- A design or task list not yet written is **absent**, not an empty value.

## Relations

- Lives under the [Root](root.md)'s `changesDir`.
- Moves through the [ChangeState](../ontology/process/change-state.md) machine.
- Like every model type, it has a JSON Schema as well as a static type, so it can be checked where no compiler runs.

## Example

- A change whose proposal and deltas exist but whose design and tasks do not has `design` and `tasks` absent.
- A `Change` with `id` `"Add_Thing"` fails the check.
- `add-openspec-ontology` and `baseline-agentscript-durable` are changes in this repository.

## Spec

- `openspec/model`: A change gathers its artifacts and its state
- `openspec/model`: Every model type has a static type and a JSON Schema
