---
id: unclaimed-scenario
name: Unclaimed scenario
kind: type
area: taxonomy
spec:
  - "openspec/model: An unclaimed scenario is a coverage gap"
related: [scenario-ref, task-link, link-basis, change-loop, change-outcome]
status: modelled
---

# Unclaimed scenario

A scenario in one of the change's deltas that no task claims: a coverage gap.

## Definition

```
unclaimed scenario = a ScenarioRef s, in some delta of the change, such that no task has
                     a "scenario-named" link to s, nor a "requirement-named" link to s's requirement
```

## Invariants

- Only a `"scenario-named"` link to the scenario, or a `"requirement-named"` link to its requirement, claims it.
- Links of weaker basis (`"capability-named"`, `"file-overlap"`, `"inferred"`) do not claim a scenario.

## Relations

- A [ScenarioRef](scenario-ref.md), judged against every task's [TaskLink](task-link.md)s and their [LinkBasis](link-basis.md).
- The [change loop](../ontology/loops/change-loop.md) must close these gaps; its [ChangeOutcome](../ontology/loops/change-outcome.md) reports them as `unclaimed`.

## Example

- A delta scenario whose only link is a `"file-overlap"` link from task `1.3` is listed as unclaimed.
- A task whose text names a requirement with three scenarios claims all three: none is listed.

## Spec

- `openspec/model`: An unclaimed scenario is a coverage gap
