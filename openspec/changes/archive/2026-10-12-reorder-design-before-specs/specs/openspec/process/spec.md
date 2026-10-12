## REMOVED Requirements

### Requirement: Design and plan follow the deltas
**Reason**: The design now comes before the deltas, so it no longer follows them.
**Migration**: Replaced by "Design follows the proposal" and "Plan follows the deltas and the design".

## ADDED Requirements

### Requirement: Design follows the proposal
The model SHALL define `design` with input `{ proposal: Proposal }`, output `Design`, actor `"agent"`. `STEPS` SHALL list `design` second, after `propose` and before `specify`.

#### Scenario: Design sees only the proposal
- **WHEN** a `DesignInput` holding a proposal and deltas is checked
- **THEN** the check SHALL fail, and one holding only the proposal SHALL pass

#### Scenario: The steps in lifecycle order
- **WHEN** the names in `STEPS` are listed
- **THEN** they SHALL be `propose`, `design`, `specify`, `plan`, `validate`, `approve`, `execute`, `archive`

### Requirement: Plan follows the deltas and the design
The model SHALL define `plan` with input `{ proposal, deltas, design }`, output `TaskList`, actor `"agent"`.

#### Scenario: Plan sees the design
- **WHEN** the `plan` step runs
- **THEN** its input SHALL include the `design` the `design` step produced

## MODIFIED Requirements

### Requirement: Specify turns a proposal into deltas
The model SHALL define the `specify` step with input `{ proposal: Proposal, design: Design, base: Capability[] }`, output `Delta[]`, actor `"agent"`. Each capability in `proposal.capabilities` SHALL receive at least one delta, and each `Modified` or `Removed` delta MUST name a requirement present in `base`.

#### Scenario: A modified delta must exist in the base
- **WHEN** `specify` emits a `Modified` delta whose requirement name is absent from `base`
- **THEN** the output SHALL fail validation

#### Scenario: Specify sees the design
- **WHEN** a `SpecifyInput` without a `design` is checked
- **THEN** the check SHALL fail

### Requirement: A change moves through a fixed sequence of states
The model SHALL define `ChangeState` as `"drafting"`, `"designed"`, `"specified"`, `"planned"`, `"validated"`, `"approved"`, `"executing"`, `"converged"`, `"archived"`, `"amended"` or `"abandoned"`. `"drafting"` SHALL be the initial state. The forward path SHALL be drafting → designed → specified → planned → validated → approved → executing → converged → archived.

#### Scenario: The forward path
- **WHEN** a change completes every step without amendment
- **THEN** it SHALL pass through the nine forward states in that order

#### Scenario: A new change starts drafting
- **WHEN** `propose` returns the first `Proposal` for a new change id
- **THEN** the change SHALL exist in state `"drafting"`, and no transition SHALL lead into `"drafting"`

### Requirement: Each forward transition follows its step
`drafting → designed` SHALL follow `design`; `→ specified` follows `specify`; `→ planned` follows `plan`; `planned → validated` needs a `ValidationReport` with `valid` `true`. Any other transition than those defined in `openspec/process` MUST be refused.

#### Scenario: Skipping planning is refused
- **WHEN** a change in `specified` is moved to `validated`
- **THEN** the transition SHALL be refused

#### Scenario: Specifying before designing is refused
- **WHEN** `specify` completes for a change in `drafting`
- **THEN** the transition SHALL be refused
