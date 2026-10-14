`pnpm change build <change>` shows a proposed amendment as a diff against the file on disk, along with the question. `pnpm change build <change> --amend` writes the amended delta and runs `openspec validate <change> --strict`. If validation passes, the blocked loop resumes with the decision recorded as "amendment applied". If it fails, the file is restored, nothing resumes and the errors are printed. A text answer works as it does today. Follows add-spec-amendments-judge.

Why: gaps.md #8 and #17. Five times a person edited a delta by hand to answer an amend-spec escalation, and once the hand edit then failed the size rules at verify. --amend validates before anything resumes.

Out of scope: applying without the principal; an agent applying an amendment; amending proposal, design or tasks; the folded specs in openspec/specs/.
