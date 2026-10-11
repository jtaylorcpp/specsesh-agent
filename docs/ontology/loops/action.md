---
id: action
name: Action
kind: type
area: loops
spec:
  - "openspec/loops: An action records what an iteration did"
  - "openspec/loops: An iteration plans, acts, gathers evidence and judges"
related: [iteration, diff-evidence, check-evidence, evidence]
status: modelled
---

# Action

Something an iteration did: an edit, a command, or a delegation to another agent.

## Definition

```
Action { kind: "edit" | "command" | "delegate", summary: string, refs: string[] }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | `"edit"` \| `"command"` \| `"delegate"` | What sort of thing was done. |
| summary | `string` | One line saying what and why. |
| refs | `string[]` | For `"edit"`, the files edited; for `"command"`, the command line run; for `"delegate"`, the agent delegated to. |

## Invariants

- `kind` is one of the three values; any other (e.g. `"think"`) fails the check.
- An action records *what was done*, never its result. Diffs and command results are [evidence](../evidence/evidence.md): [DiffEvidence](../evidence/diff-evidence.md) and [CheckEvidence](../evidence/check-evidence.md).

## Relations

- Element of [Iteration](iteration.md)`.actions`.
- Its effects are recorded as [Evidence](../evidence/evidence.md) in the same iteration.

## Example

An iteration of task `2.4` that runs the durable suite records `{ kind: "command", summary: "run the durable tests", refs: ["pnpm --filter agentscript-durable test"] }`. The suite's exit code goes in a `CheckEvidence`, and each `Scenario:` test's result in a `TestEvidence`, not on the action.

## Spec

- `openspec/loops: An action records what an iteration did`
- `openspec/loops: An iteration plans, acts, gathers evidence and judges`
