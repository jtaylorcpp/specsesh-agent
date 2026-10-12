## ADDED Requirements

### Requirement: A spec loop streams its own event kinds
A spec loop's events, each with `loop`, SHALL be `stage-started` with `change`, `stage`, `script`, `at`; one `stage-draft` per gate round with `draft`, `written` and `issues`; `stage-review` with `files` and `question`, or `stage-question` with `question`; and `stage-ended` with `status`, `drafts` and `approved`. They SHALL be JSON Lines on stderr after the resume hint.

#### Scenario: A proposal's stream
- **WHEN** a proposal stage reaches review on its second draft
- **THEN** the events SHALL be, in order, `stage-started`, two `stage-draft` with `draft` `1` and `2`, `stage-review` naming `proposal.md`, and `stage-ended` with `status` `"blocked"` and `drafts` `2`

#### Scenario: An approval's stream
- **WHEN** a review is answered `approve`
- **THEN** the events SHALL be `stage-started` then `stage-ended` with `status` `"converged"`, `drafts` `0` and `approved` `true`

#### Scenario: A question is its own event
- **WHEN** a stage's script asks a question
- **THEN** the stream SHALL hold `stage-question` with that question, and no `stage-review`

### Requirement: The live run also drafts a proposal
`pnpm test:live` SHALL also run `agentscript-task spec fixture-live-spec --intent <one line>` in its copy of the repo, with the repo config. It is never part of `pnpm test`, and skips as the task live run does.

#### Scenario: The live proposal reaches review clean
- **GIVEN** `claude` logged in
- **WHEN** `pnpm test:live` runs
- **THEN** the spec run SHALL exit `0`, emit `stage-review`, and leave a `proposal.md` on which `proposalStage.gate` reports no `ERROR` or `WARNING`
