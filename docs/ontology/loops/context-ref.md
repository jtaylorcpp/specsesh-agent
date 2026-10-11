---
id: context-ref
name: ContextRef
kind: type
area: loops
spec:
  - "openspec/loops: A context reference names what a loop reads"
  - "openspec/model: References serialise to one line of text"
related: [loop-input, capability-path, requirement-ref, scenario-ref, change]
status: implemented
---

# ContextRef

A pointer to something a loop reads: a file, a spec item, a change or a doc.

## Definition

```
ContextRef { kind: "file" | "capability" | "requirement" | "scenario" | "change" | "doc", ref: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | one of six values | What sort of thing `ref` points at. |
| ref | `string` | For `"capability"`, `"requirement"`, `"scenario"`: the serialised [CapabilityPath](../../taxonomy/capability-path.md), [RequirementRef](../../taxonomy/requirement-ref.md) or [ScenarioRef](../../taxonomy/scenario-ref.md). For `"file"` and `"doc"`: a repository-relative path. For `"change"`: a change id. |

## Invariants

- Spec references serialise with ` › ` (space, U+203A, space) between path, requirement and scenario, and `/` between path segments. Parsing gives back the same reference.
- Because a spec `ref` parses to a typed reference, a context that points at a scenario, requirement or capability that doesn't exist is detectable before the loop runs.

## Relations

- Element of [LoopInput](loop-input.md)`.context`.
- Reuses the taxonomy's references: [CapabilityPath](../../taxonomy/capability-path.md), [RequirementRef](../../taxonomy/requirement-ref.md), [ScenarioRef](../../taxonomy/scenario-ref.md); a `"change"` ref names a [Change](../../taxonomy/change.md).

## Example

The task loop for task `2.4` reads:
- `{ kind: "scenario", ref: "durable/cli › run resolves provider and model from flag, then environment, then defaults › Defaults apply when nothing is set" }`
- `{ kind: "file", ref: "packages/agentscript-durable/src/cli.ts" }`
- `{ kind: "change", ref: "baseline-agentscript-durable" }`

## Spec

- `openspec/loops: A context reference names what a loop reads`
- `openspec/model: References serialise to one line of text`
