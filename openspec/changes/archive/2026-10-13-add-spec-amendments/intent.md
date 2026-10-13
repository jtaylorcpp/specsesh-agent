When a task loop or a group judge escalates with `amend-spec`, the escalation carries the proposed amendment: which spec delta under `openspec/changes/<change>/specs/` it changes, and the full replacement text of that file. `pnpm change build <change>` shows the proposed amendment (as a diff against the file on disk) along with the question.

The principal applies it with `pnpm change build <change> --amend`. That writes the amended delta, runs `openspec validate <change> --strict`, and only if validation passes resumes the blocked loop with the decision recorded as the amendment applied. If validation fails, the file is restored, nothing resumes, and the validation errors are printed. Answering with text instead of `--amend` works as it does today: the answer goes to the loop and nothing is written.

Why: gaps.md #8. Four times in the 21-change run an agent caught a defect in a hand-written spec and escalated `amend-spec` (add-actors-and-workspaces 3.6, add-spec-cli 1.4, add-spec-plan-stage 1.4, add-change-draft 1.5). Each time a person edited the delta by hand and answered the loop.

Out of scope: amending proposal.md, design or tasks.md; applying an amendment without the principal; an agent answering an amendment; amending the folded specs in openspec/specs/.
