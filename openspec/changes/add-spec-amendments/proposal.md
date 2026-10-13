## Why

gaps.md #8. Four times in the 21-change run an agent caught a defect in a hand-written spec and escalated `amend-spec`: add-actors-and-workspaces 3.6, add-spec-cli 1.4, add-spec-plan-stage 1.4 and add-change-draft 1.5. Each time a person edited the delta by hand and then answered the loop. The agent had already found the fix, but neither its `amend-spec` reply nor the escalation had anywhere to put it. So the principal had to write the fix again, and nothing checked the edit before the loop resumed.

This change is the first step: the task loop's agent proposes the amendment, and the escalation carries it.

## What Changes

- An `amend-spec` escalation carries the proposed amendment:
  - which spec delta under `openspec/changes/<change>/specs/` it changes;
  - the full replacement text of that file.
- The loop vocabulary gains a decision that records that the amendment was applied. The command that applies an amendment comes in a later slice.
- The task loop's `amend-spec` reply contract changes. The agent's reply now carries the target delta path and the full replacement text, and the task loop's escalation passes them through.
- Answering an `amend-spec` escalation with text works as it does today: the answer goes to the loop and nothing is written.

## Out of scope

- The group judge proposing an amendment for an `amend-spec` finding. This is slice 2 in slices.md.
- `pnpm change build` showing the amendment as a diff, and `--amend` applying it, validating it and resuming the loop. This is slice 3 in slices.md.
- Amending `proposal.md`, the design or `tasks.md`.
- Applying an amendment without the principal.
- An agent answering an amendment.
- Amending the folded specs in `openspec/specs/`.

## Capabilities

**Modified:** `openspec/loops`, `task/agent`

## Impact

- `openspec/loops`: the `amend-spec` escalation gets an amendment (target delta path plus full replacement text), and a new decision records that an amendment was applied.
- `task/agent`: the agent's `amend-spec` reply carries the target delta path and the full replacement text, and the task loop's `LoopOutcome` escalation includes them.
- Not changed here: `task/group` (slice 2) and `change/cli` (slice 3).
