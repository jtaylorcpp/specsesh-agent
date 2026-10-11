---
id: evidence
name: Evidence
kind: type
area: evidence
spec:
  - "openspec/evidence: Evidence is one of five kinds"
related: [test-evidence, validation-evidence, check-evidence, diff-evidence, review-evidence, verdict, finding]
status: modelled
---

# Evidence

What a loop's verdict may rest on: one of five kinds, discriminated by `kind`.

## Definition

```
Evidence = TestEvidence | ValidationEvidence | CheckEvidence | DiffEvidence | ReviewEvidence
```

## Invariants

- `kind` SHALL be one of `"test"`, `"validation"`, `"check"`, `"diff"`, `"review"`; any other kind fails its check.
- Only a passing `TestEvidence` can satisfy a scenario target; a check satisfies only its own command; a skip satisfies nothing.

## Relations

- Its kinds: [TestEvidence](test-evidence.md), [ValidationEvidence](validation-evidence.md), [CheckEvidence](check-evidence.md), [DiffEvidence](diff-evidence.md), [ReviewEvidence](review-evidence.md).
- Gathered by an [Iteration](../loops/iteration.md); the only thing a [Verdict](../loops/verdict.md) is judged from.
- A [Finding](finding.md) rests on at least one.

## Example

Evidence with `kind: "vibe"` fails its check.

## Spec

- `openspec/evidence: Evidence is one of five kinds`
