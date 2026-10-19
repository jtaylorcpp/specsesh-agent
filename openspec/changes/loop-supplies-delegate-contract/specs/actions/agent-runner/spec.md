## MODIFIED Requirements

### Requirement: A call runs the script as a durable child in the caller's workspace
A call SHALL start an `agentscript.run` child with the grant's script, `variables: { instructions }`, `entry` every subagent in source order, `model` the grant's model's `ModelRef`, `scope` the grant's tools and `maxSteps`, over the caller's registry and workspace, and no `delegatePreamble`. `instructions` SHALL be the context's `delegatePreamble`, a blank line and the call's instructions when it carries one, else the call's. It waits by child id, then answers `{ ok, summary, files_changed }`.

#### Scenario: A reviewer on another model answers
- **GIVEN** a caller on model `default` and a grant `reviewer` on model `opus` running `READ_AGENT`, both faux
- **WHEN** the caller runs `@actions.review` with `instructions` `"Review src/a.ts"`
- **THEN** the child's steps SHALL run on `opus`, and the call SHALL answer the child's `ok` and `summary`

#### Scenario: An editing delegate's changes are counted
- **GIVEN** a git workspace and a grant running `EDIT_AGENT` whose faux model edits `src/a.ts`
- **WHEN** the call completes
- **THEN** `files_changed` SHALL be `1` and the record's `DiffEvidence` SHALL hold `src/a.ts` `modified`

#### Scenario: An agent delegate is seeded with the run's preamble
- **GIVEN** a caller run with `delegatePreamble` `"Task 2.1: Do X"` and a grant `reviewer` running `READ_AGENT`
- **WHEN** the caller runs `@actions.review` with `instructions` `"Review src/a.ts"`
- **THEN** the child SHALL be seeded with `instructions` `"Task 2.1: Do X\n\nReview src/a.ts"`, and its input SHALL have no `delegatePreamble`
