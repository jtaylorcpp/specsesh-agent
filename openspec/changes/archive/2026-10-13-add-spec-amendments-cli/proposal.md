## Why

People are editing spec deltas by hand to answer amend-spec escalations, and nothing checks that edit until it is too late. Gaps #8 and #17 record five cases where a person hand-edited a delta to answer an amend-spec escalation. In one of them, the hand edit then failed the size rules at verify, after the blocked loop had already resumed.

Adding `--amend` to `pnpm change build` lets the principal apply the proposed amendment from the CLI. The amended delta is checked before anything resumes. If it fails, the file on disk goes back to how it was.

The check has to be `openspec validate --all --strict`, which is what `pnpm spec:check` runs. The single-change form is not enough. On 2026-10-13, `openspec validate <change> --strict` passed add-delete-file-grant, but `--all --strict` failed it because a requirement was over 500 characters (gap #17).

This change follows add-spec-amendments-judge, which proposes the amendment.

## What Changes

- `pnpm change build <change>` shows a proposed amendment as a diff against the delta file on disk, along with the escalation's question.
- `pnpm change build <change> --amend` writes the amended delta and then runs `openspec validate --all --strict`, the same check `pnpm spec:check` runs.
  - If validation reports no errors and no warnings, the blocked loop resumes with the decision recorded as "amendment applied".
  - If validation reports any error or warning, the delta file is restored to what it was before, nothing resumes, and the validation output is printed.
- A text answer to the escalation works as it does today.

## Out of scope

- Applying an amendment without the principal.
- An agent applying an amendment.
- Amending the proposal, design or tasks. Only spec deltas can be amended.
- The folded specs in `openspec/specs/`.

## Capabilities

**Modified:** `change/cli`

## Impact

- The `build` command of `agentscript-change` (`pnpm change`): it shows the amendment diff, adds the `--amend` flag, runs `openspec validate --all --strict`, restores the file when there is any error or warning, and resumes the blocked loop with the decision "amendment applied".
- It depends on the amendment proposal that add-spec-amendments-judge produces.
- No change to how a text answer is handled.
