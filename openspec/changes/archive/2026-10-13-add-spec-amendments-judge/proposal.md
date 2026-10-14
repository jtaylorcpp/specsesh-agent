## Why

gaps.md #8: when the group judge finds that a spec delta itself is wrong, it can't say how to fix it. add-spec-amendments (archived) gave this to the task loop. It added the `Amendment` type, `Escalation.amendment` and the reserved `amendment-applied` decision. The group loop has none of this yet. This change gives the group judge the same ability and reuses those pieces.

## What Changes

- The group judge's `amend-spec` finding carries an `Amendment`: the path of the spec delta to change and the full replacement text.
- When the group loop escalates on an `amend-spec` finding, its `Escalation.amendment` holds that `Amendment` unchanged, so the principal sees exactly what the judge proposed.
- An answer to that escalation with the reserved `amendment-applied` decision resumes the group loop, the same way it resumes the task loop.
- No new types: the group loop uses `Amendment`, `Escalation.amendment` and `amendment-applied` as add-spec-amendments defined them.

## Out of scope

- The CLI for reviewing and applying amendments (add-spec-amendments-cli).
- Amending a change's proposal, design or tasks. Only spec deltas can be amended.
- Any change to the task loop's amendments or to the `Amendment` type itself.
- The change loop and its change check.

## Capabilities

**Modified:** `task/group`

## Impact

- The group loop: the shape of the judge's finding, the escalation the loop builds from an `amend-spec` finding, and how the loop resumes on `amendment-applied`.
- Tests for the group loop's escalation and resume paths.
- No new dependencies. Depends on the archived add-spec-amendments.
