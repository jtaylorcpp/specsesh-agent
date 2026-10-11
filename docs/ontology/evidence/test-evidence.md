---
id: test-evidence
name: TestEvidence
kind: type
area: evidence
spec:
  - "openspec/evidence: Test evidence ties a test to a scenario"
  - "openspec/evidence: A test claims a scenario by its exact name"
  - "openspec/evidence: A passing claiming test satisfies a scenario target"
  - "openspec/evidence: A skipped test satisfies nothing"
related: [evidence, scenario-ref, target, verdict]
status: implemented
---

# TestEvidence

A test's result, tied to the scenario its name claims.

## Definition

```
TestEvidence { kind: "test", file: string, name: string, scenario?: ScenarioRef, status: "pass" | "fail" | "skip", message?: string }
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| kind | `"test"` | Discriminant. |
| file | `string` | The test file. |
| name | `string` | The test's full name as the runner reports it. |
| scenario | `ScenarioRef`, optional | The scenario the test claims by name. |
| status | `"pass"` · `"fail"` · `"skip"` | The result. |
| message | `string`, optional | The runner's message. |

## Invariants

- A test SHALL claim a scenario when its name is `Scenario: <exact scenario name>`; `scenario` MUST name that scenario and no other. A near-miss name claims nothing.
- A `ScenarioRef` target SHALL be satisfied exactly when the evidence holds a `TestEvidence` with `status: "pass"` whose `scenario` is that target.
- `status: "fail"` leaves the claimed scenario unmet.
- `status: "skip"` MUST NOT satisfy any target.

## Relations

- A kind of [Evidence](evidence.md); points at a [ScenarioRef](../../taxonomy/scenario-ref.md).
- Satisfies scenario [Target](../loops/target.md)s in a [Verdict](../loops/verdict.md).

## Example

The test `Scenario: Argv building and spawning stay module-level`, passing in `packages/agentscript-pi/__tests__/claude-code.test.ts`, is `{ kind: "test", file: "packages/agentscript-pi/__tests__/claude-code.test.ts", name: "…Scenario: Argv building and spawning stay module-level", status: "pass", scenario: <pi/claude-code › that scenario> }`. A test named `Scenario: The first and second model steps are numbered 0 & 1` claims nothing (the scenario says "0 and 1"). The Cloudflare route script's `SKIP Default Workers AI model` recorded with `status: "skip"` leaves `Default Workers AI model` unmet.

## Spec

- `openspec/evidence: Test evidence ties a test to a scenario`
- `openspec/evidence: A test claims a scenario by its exact name`
- `openspec/evidence: A passing claiming test satisfies a scenario target`
- `openspec/evidence: A skipped test satisfies nothing`
