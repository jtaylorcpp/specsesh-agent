---
id: target
name: Target
kind: type
area: loops
spec:
  - "openspec/loops: A verdict lists satisfied and unmet targets"
  - "openspec/evidence: A check is evidence for its command only"
related: [verdict, requirement-ref, scenario-ref, check-evidence]
status: modelled
---

# Target

What a verdict judges: a requirement, a scenario, or a named check.

## Definition

```
Target = RequirementRef | ScenarioRef | { check: string }   // a named check, e.g. "strict validation"
```

## Invariants

- A `ScenarioRef` target is satisfied exactly when the evidence holds a passing `TestEvidence` whose `scenario` is that target.
- A `RequirementRef` target is satisfied exactly when every scenario of that requirement is satisfied.
- A named-check target is satisfied by `CheckEvidence` for that command with `exitCode` `0`; such evidence MUST NOT satisfy any scenario or requirement target.
- A named check is written `{ check: string }`, e.g. `{ check: "strict validation" }`.

## Relations

- [RequirementRef](../../taxonomy/requirement-ref.md) and [ScenarioRef](../../taxonomy/scenario-ref.md) are two of its forms.
- Judged in a [Verdict](verdict.md); named checks are satisfied by [CheckEvidence](../evidence/check-evidence.md).
- Referenced by a [Finding](../evidence/finding.md)'s optional `target`.

## Example

The change loop's targets include every delta scenario as a `ScenarioRef`, plus a named check for strict validation and one for the full suite. `pnpm test` exiting 0 satisfies the suite check and no scenario.

## Spec

- `openspec/loops: A verdict lists satisfied and unmet targets`
- `openspec/evidence: A check is evidence for its command only`
