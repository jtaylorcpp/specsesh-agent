# openspec/process Specification

## Purpose
The lifecycle of an OpenSpec change as typed steps, each with a named input, output and actor, and the state machine a change moves through from drafting to archived.

## Requirements

### Requirement: A step has a named input, output and actor
The model SHALL define `Step<In, Out>` as a named step with an input type `In`, an output type `Out` and an actor of `"principal"`, `"agent"`, `"tool"` or `"loop"`. Every step's `In` and `Out` MUST be types defined in `openspec/model`, `openspec/process`, `openspec/loops` or `openspec/evidence`.

#### Scenario: Every step's types are named
- **WHEN** the eight lifecycle steps are listed
- **THEN** each SHALL name an input type and an output type that both have a JSON Schema

### Requirement: A step returns a result, never throws
The model SHALL define `StepResult<Out>` as `{ ok: true, value: Out }` or `{ ok: false, failure: StepFailure }`, and `StepFailure` as `{ step: string, kind: "invalid-input" | "refused" | "blocked" | "error", message: string, findings: Finding[] }`.

#### Scenario: Input that fails its schema
- **WHEN** a step receives an input that fails its input schema
- **THEN** it SHALL return `{ ok: false, failure }` with `failure.kind` `"invalid-input"`, not throw

### Requirement: Failure kinds mean distinct things
`"invalid-input"` SHALL mean the input failed its schema; `"refused"` that a guard did not hold; `"blocked"` that a decision the step cannot make itself is needed, and is escalated to a principal or an agent; `"error"` anything the step could not act on. A failure caused by evidence SHALL carry that evidence's findings.

#### Scenario: Archiving without a valid report is refused
- **WHEN** archive is given a change whose latest `ValidationReport` has `valid` `false`
- **THEN** it SHALL fail with `kind` `"refused"`

### Requirement: Propose turns intent into a proposal
The model SHALL define the `propose` step with input `Intent` = `{ words: string, existing: CapabilityIndex }`, output `Proposal`, actor `"agent"` drafting from the principal's `words`. Its first `Proposal` creates the change, in state `"drafting"`. `CapabilityIndex` SHALL list every existing `CapabilityPath` with its `purpose`.

#### Scenario: The proposal reuses existing capability paths
- **GIVEN** an `Intent` whose `existing` lists `["durable","cli"]`
- **WHEN** the proposal modifies the durable CLI
- **THEN** `capabilities.modified` SHALL hold `["durable","cli"]`, not a near-duplicate path

### Requirement: Specify turns a proposal into deltas
The model SHALL define the `specify` step with input `{ proposal: Proposal, base: Capability[] }`, output `Delta[]`, actor `"agent"`. Each capability in `proposal.capabilities` SHALL receive at least one delta, and each `Modified` or `Removed` delta MUST name a requirement present in `base`.

#### Scenario: A modified delta must exist in the base
- **WHEN** `specify` emits a `Modified` delta whose requirement name is absent from `base`
- **THEN** the output SHALL fail validation

### Requirement: Design and plan follow the deltas
The model SHALL define `design` with input `{ proposal, deltas }`, output `Design`, actor `"agent"`; and `plan` with input `{ proposal, deltas, design }`, output `TaskList`, actor `"agent"`.

#### Scenario: Plan sees the design
- **WHEN** the `plan` step runs
- **THEN** its input SHALL include the `design` the `design` step produced

### Requirement: Validate reports issues by level
The model SHALL define `validate` with input `Change`, output `ValidationReport`, actor `"tool"`, where `ValidationReport` is `{ valid: boolean, issues: { level: "ERROR" | "WARNING" | "INFO", path: string, message: string }[] }`. Under strict validation, `valid` SHALL be `false` when any issue is `ERROR` or `WARNING`.

#### Scenario: A warning fails strict validation
- **GIVEN** a requirement whose text exceeds 500 characters, reported as a `WARNING`
- **WHEN** the change is validated strictly
- **THEN** `valid` SHALL be `false`

### Requirement: Approve is the principal's gate
The model SHALL define `approve` with input `{ change: Change, report: ValidationReport }`, output `Approval` = `{ approved: boolean, by: "principal", principal: string, notes: string }`, actor `"principal"`, where `principal` names who approved. No agent or tool MAY produce an `Approval`.

#### Scenario: An agent cannot approve
- **WHEN** an `Approval` with `by` `"agent"` is checked
- **THEN** it SHALL be rejected as invalid input, and SHALL NOT satisfy the approval guard

### Requirement: Execute runs the change loop
The model SHALL define `execute` with input an approved `Change`, output `LoopOutcome<ChangeOutcome>` (see `openspec/loops`), actor `"loop"`.

#### Scenario: Execute produces a change outcome
- **WHEN** `execute` returns successfully
- **THEN** its value SHALL be a `LoopOutcome<ChangeOutcome>` whose `result.groups`, when present, cover every `TaskGroup` of the change

### Requirement: Archive folds a converged change, guarded
The model SHALL define `archive` with input `{ change: Change, outcome: LoopOutcome<ChangeOutcome> }`, output `ArchiveResult` = `{ archivedAs: string, totals: { added, modified, removed, renamed: integer }, specsUpdated: CapabilityPath[] }`, actor `"tool"`. The outcome's status MUST be `"converged"`.

#### Scenario: The durable baseline's archive
- **GIVEN** `baseline-agentscript-durable` archived on 2026-10-11
- **WHEN** its result is described
- **THEN** it SHALL be `{ archivedAs: "2026-10-11-baseline-agentscript-durable", totals: { added: 140, modified: 0, removed: 0, renamed: 0 }, specsUpdated }` with nine paths

#### Scenario: An exhausted change is not archived
- **WHEN** archive receives a `LoopOutcome<ChangeOutcome>` with `status` `"exhausted"`
- **THEN** it SHALL fail with `kind` `"refused"`

### Requirement: A change moves through a fixed sequence of states
The model SHALL define `ChangeState` as `"drafting"`, `"specified"`, `"designed"`, `"planned"`, `"validated"`, `"approved"`, `"executing"`, `"converged"`, `"archived"`, `"amended"` or `"abandoned"`. `"drafting"` SHALL be the initial state. The forward path SHALL be drafting → specified → designed → planned → validated → approved → executing → converged → archived.

#### Scenario: The forward path
- **WHEN** a change completes every step without amendment
- **THEN** it SHALL pass through the nine forward states in that order

#### Scenario: A new change starts drafting
- **WHEN** `propose` returns the first `Proposal` for a new change id
- **THEN** the change SHALL exist in state `"drafting"`, and no transition SHALL lead into `"drafting"`

### Requirement: Each forward transition follows its step
`drafting → specified` SHALL follow `specify`; `→ designed` follows `design`; `→ planned` follows `plan`; `planned → validated` needs a `ValidationReport` with `valid` `true`. Any other transition than those defined in `openspec/process` MUST be refused.

#### Scenario: Skipping planning is refused
- **WHEN** a change in `designed` is moved to `validated`
- **THEN** the transition SHALL be refused

### Requirement: Execution needs approval
`validated → approved` SHALL need an `Approval` with `approved` `true` from the principal, and `approved → executing` SHALL follow `execute` starting. A change MUST NOT enter `executing` from any other state.

#### Scenario: Executing without approval is refused
- **WHEN** a change in `validated` is moved to `executing`
- **THEN** the transition SHALL be refused

### Requirement: Archiving needs convergence and a fresh valid report
`executing → converged` SHALL need a `LoopOutcome<ChangeOutcome>` with `status` `"converged"`. `converged → archived` SHALL need a `ValidationReport` with `valid` `true` produced after convergence; the archive step SHALL produce it by validating the change itself, as its first act, and refuse if it is not valid.

#### Scenario: A stale report does not license archive
- **GIVEN** a change whose only valid report predates its execution
- **WHEN** it is moved from `converged` to `archived`
- **THEN** the transition SHALL be refused

### Requirement: A spec defect sends the change back through amendment
`executing → amended` SHALL happen when the change loop ends on a `spec-defect` finding. From `amended` the change SHALL return to `validated` only once the amended deltas validate, and to `approved` only with a new `Approval`.

#### Scenario: An amendment is re-approved
- **GIVEN** a change in `amended` whose amended deltas now validate
- **WHEN** it reaches `validated`
- **THEN** it SHALL need a new `Approval` before it can execute again

### Requirement: Any change may be abandoned
Every state except `archived` SHALL allow a transition to `abandoned`. `abandoned` and `archived` SHALL be terminal: no transition leaves them.

#### Scenario: An archived change cannot be abandoned
- **WHEN** a change in `archived` is moved to `abandoned`
- **THEN** the transition SHALL be refused
