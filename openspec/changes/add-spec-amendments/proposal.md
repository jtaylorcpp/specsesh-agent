## Why

gaps.md #8. Four times in the 21-change run an agent caught a defect in a hand-written spec and escalated `amend-spec`: add-actors-and-workspaces 3.6, add-spec-cli 1.4, add-spec-plan-stage 1.4 and add-change-draft 1.5. Each time a person edited the delta by hand and then answered the loop. The agent had already found the fix, but the escalation could not carry it, so the principal had to write it again and nothing checked the edit before the loop resumed.

## What Changes

- An `amend-spec` escalation, raised by a task loop or a group judge, carries the proposed amendment: which spec delta under `openspec/changes/<change>/specs/` it changes, and the full replacement text of that file.
- `pnpm change build <change>` shows the proposed amendment as a diff against the file on disk, along with the escalation's question.
- `pnpm change build <change> --amend` writes the amended delta and runs `openspec validate <change> --strict`.
  - If validation passes, the blocked loop resumes. Its decision is recorded as "amendment applied".
  - If validation fails, the file is restored, nothing resumes, and the validation errors are printed.
- Answering with text instead of `--amend` works as it does today: the answer goes to the loop and nothing is written.

## Out of scope

- Amending `proposal.md`, the design or `tasks.md`.
- Applying an amendment without the principal.
- An agent answering an amendment.
- Amending the folded specs in `openspec/specs/`.

## Capabilities

**Modified:** `openspec/loops`, `change/cli`

## Impact

- `openspec/loops`: the `amend-spec` escalation gets an amendment (target delta path plus full replacement text), and a new decision records that the amendment was applied.
- `change/cli`: `build` shows the amendment diff and accepts `--amend`, which writes the delta, validates it, and either resumes the loop or restores the file.
- Code: the task loop (`task/agent`) and the group judge (`task/group`) pass the amendment through on their escalations. Their specs do not change.
