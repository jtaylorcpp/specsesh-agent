---
id: check-evidence
name: CheckEvidence
kind: type
area: evidence
spec:
  - "openspec/evidence: The other evidence kinds have fixed fields"
  - "openspec/evidence: A check is evidence for its command only"
related: [evidence, target]
status: modelled
---

# CheckEvidence

A command and its exit code. Evidence for that command only.

## Definition

```
CheckEvidence { kind: "check", command: string, exitCode: integer, output: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | `"check"` | Discriminant. |
| command | `string` | The command run. |
| exitCode | `integer` | Its exit code. |
| output | `string` | Its output. |

## Invariants

- With `exitCode` `0` it SHALL satisfy only a target naming that command.
- It MUST NOT satisfy any scenario or requirement target.

## Relations

- A kind of [Evidence](evidence.md); satisfies named-check [Target](../loops/target.md)s only.

## Example

`pnpm check` exiting 0 is `{ kind: "check", command: "pnpm check", exitCode: 0, output: "…" }`. `pnpm test` exiting 0 while no `TestEvidence` claims a scenario leaves that scenario unmet.

## Spec

- `openspec/evidence: The other evidence kinds have fixed fields`
- `openspec/evidence: A check is evidence for its command only`
