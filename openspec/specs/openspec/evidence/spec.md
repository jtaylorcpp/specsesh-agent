# openspec/evidence Specification

## Purpose
What a loop's verdict may rest on: five kinds of evidence, the findings a failed check produces, and the rules for when evidence satisfies a scenario or requirement target.

## Requirements

### Requirement: Evidence is one of five kinds
The model SHALL define `Evidence` as the union of `TestEvidence`, `ValidationEvidence`, `CheckEvidence`, `DiffEvidence` and `ReviewEvidence`, discriminated by `kind`: `"test"`, `"validation"`, `"check"`, `"diff"` and `"review"`.

#### Scenario: An unknown kind is refused
- **WHEN** evidence with `kind` `"vibe"` is checked
- **THEN** the check SHALL fail

### Requirement: Test evidence ties a test to a scenario
The model SHALL define `TestEvidence` as `{ kind: "test", file: string, name: string, scenario?: ScenarioRef, status: "pass" | "fail" | "skip", message?: string }`, where `name` is the test's full name as the runner reports it.

#### Scenario: A passing test from this repository
- **GIVEN** the test `Scenario: Argv building and spawning stay module-level` passing in `packages/agentscript-pi/__tests__/claude-code.test.ts`
- **WHEN** it is recorded
- **THEN** it SHALL be `TestEvidence` with that `file` and `name`, `status` `"pass"`, and `scenario` naming `pi/claude-code`

### Requirement: The other evidence kinds have fixed fields
`ValidationEvidence` SHALL be `{ kind: "validation", report: ValidationReport }`; `CheckEvidence` `{ kind: "check", command: string, exitCode: integer, output: string }`; `DiffEvidence` `{ kind: "diff", files: { path: string, change: "added" | "modified" | "deleted" }[] }`; `ReviewEvidence` `{ kind: "review", reviewer: "agent" | "principal", verdict: "approve" | "changes", notes: string }`.

#### Scenario: A type check is check evidence
- **WHEN** `pnpm check` exits 0
- **THEN** it SHALL be recorded as `CheckEvidence` with `command` `"pnpm check"` and `exitCode` `0`

### Requirement: A finding classifies what went wrong
The model SHALL define `Finding` as `{ kind: "code-defect" | "spec-defect" | "test-defect" | "environment" | "needs-decision", target?: Target, evidence: Evidence[], message: string }`. `evidence` SHALL be non-empty: a finding rests on evidence.

#### Scenario: A finding without evidence is refused
- **WHEN** a `Finding` with `evidence` `[]` is checked
- **THEN** the check SHALL fail

### Requirement: Finding kinds say where the fault lies
`"code-defect"` SHALL mean the code is wrong against the spec; `"spec-defect"` the spec is wrong against intended behaviour; `"test-defect"` the test is wrong; `"environment"` a cause outside the change; `"needs-decision"` a choice the loop cannot make itself, which it escalates to a principal or an agent.

#### Scenario: A spec that describes the code wrongly
- **WHEN** a test written to a scenario fails because the scenario misdescribes behaviour that is intended
- **THEN** the finding SHALL be `"spec-defect"`

### Requirement: A test claims a scenario by its exact name
A test SHALL claim a scenario when its name is `Scenario: <exact scenario name>`. `TestEvidence.scenario` MUST name the scenario whose exact name the test carries, and no other.

#### Scenario: A near-miss name claims nothing
- **WHEN** a test is named `Scenario: The first and second model steps are numbered 0 & 1`
- **THEN** it SHALL NOT claim `The first and second model steps are numbered 0 and 1`

### Requirement: A passing claiming test satisfies a scenario target
A `ScenarioRef` target SHALL be satisfied exactly when the iteration's evidence holds a `TestEvidence` with `status` `"pass"` whose `scenario` is that target.

#### Scenario: A failing test does not satisfy
- **WHEN** the only test claiming a scenario has `status` `"fail"`
- **THEN** the scenario target SHALL be unmet

### Requirement: A requirement target needs every scenario
A `RequirementRef` target SHALL be satisfied exactly when every scenario of that requirement is satisfied.

#### Scenario: Two of three is not enough
- **GIVEN** a requirement with three scenarios, two satisfied
- **WHEN** the requirement target is judged
- **THEN** it SHALL be unmet

### Requirement: A check is evidence for its command only
`CheckEvidence` with `exitCode` `0` SHALL satisfy only a target naming that command, and MUST NOT satisfy any scenario or requirement target.

#### Scenario: A green suite command is not scenario evidence
- **WHEN** `pnpm test` exits 0 but no `TestEvidence` claims a scenario
- **THEN** that scenario target SHALL be unmet

### Requirement: A skipped test satisfies nothing
`TestEvidence` with `status` `"skip"` MUST NOT satisfy any target.

#### Scenario: Skipped Workers AI checks
- **GIVEN** the Cloudflare route script's `SKIP Default Workers AI model`
- **WHEN** it is recorded as `TestEvidence` with `status` `"skip"`
- **THEN** the scenario `Default Workers AI model` SHALL be unmet
