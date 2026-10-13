# Design: add-spec-amendments-cli

## Context

When a change loop blocks on an amend-spec escalation, `pnpm change build <change> "<answer>"` only accepts a text answer. To make the edit the escalation asks for, a person opens the delta under `openspec/changes/<change>/specs/` and edits it by hand. Nothing checks that edit before the blocked loop resumes. Gaps #8 and #17 record five of these hand edits, and one of them later failed the size rules at verify.

This change uses shapes that already exist. It adds no new ones:

- **The amendment** is `Amendment { delta, text }`, as defined in `openspec/specs/openspec/loops` and `task/agent` and in add-spec-amendments-judge's `task/group` delta.
  - `delta` is the delta file's path relative to `openspec/changes/<change>/`, for example `specs/plan/export/spec.md`.
  - `text` is the whole new file.
- **Where the amendment comes from.** A task loop's escalation or the group judge's escalation can carry one. Either one blocks the change loop.
- **The decision** is the reserved string `amendment-applied`. `answerEscalation` (task loops) and `answerGroupEscalation` (the group judge) already accept it.

This change touches only the `build` command of `agentscript-change`. `draft`, `approve`, `close` and the text-answer path of `build` stay as they are.

The principal's message gives the check as `openspec validate <change> --strict`. The approved proposal requires `openspec validate --all --strict` instead, which is the same check `pnpm spec:check` runs. The proposal gives the reason: on 2026-10-13 the single-change form passed add-delete-file-grant, and `--all` caught a requirement over 500 characters. This design follows the approved proposal.

## How it is used

The full session is in `design/examples/amend-session.sh`. The rendered terminal output for every case is in `design/mock.html`.

### 1. Seeing the amendment

`pnpm change build <change>` with no answer still prints the blocked build and the question, starts nothing, and exits `1`. When the escalation the change loop is blocked on carries an `Amendment`, the output also shows a unified diff from the file at `openspec/changes/<change>/<delta>` as it is on disk to `text`. It names the loop that asked, and ends with both ways to answer:

```
$ pnpm change build add-plan-export
# add-plan-export — blocked
## group 1: converged (3 tasks, 0 reworks)
## group 2: blocked (2 tasks, 1 reworks)

## proposed amendment (from task 2.2): specs/plan/export/spec.md
--- openspec/changes/add-plan-export/specs/plan/export/spec.md (on disk)
+++ openspec/changes/add-plan-export/specs/plan/export/spec.md (amended)
@@ -12,7 +12,7 @@
 #### Scenario: Export writes JSON
 - **WHEN** `plan export p1` runs
-- **THEN** stdout SHALL be the plan as JSON
+- **THEN** stdout SHALL be the plan as JSON, with keys sorted

Scenario "Export writes JSON" cannot pass: the output is not stable. Amend the spec?

pnpm change build add-plan-export --amend
pnpm change build add-plan-export "<answer>"
exit 1
```

When the amendment comes from the group judge, the header reads `(from group 2 judge)`. When the escalation has no amendment, the output is the same as it is today.

### 2. Applying it: `--amend`

```
$ pnpm change build add-plan-export --amend
amended openspec/changes/add-plan-export/specs/plan/export/spec.md
## openspec validate --all --strict: passed
resumed task 2.2 with decision: amendment-applied
# add-plan-export — converged
...
pnpm change close add-plan-export
```

`--amend` runs these steps in order:

1. **Refuse (exit `2`, change nothing)** if any of these is true:
   - the change's latest change loop is not `blocked`;
   - the escalation it is blocked on carries no `Amendment`;
   - an answer is also given;
   - `delta` does not match `specs/**/spec.md`, after normalising, with no `..` segments and not absolute.
2. **Resolve and write.** The target is `openspec/changes/<change>/<delta>`. Read its current bytes into memory, or note that the file does not exist. Then write `text` to it.
3. **Validate.** Run `openspec validate --all --strict` with `OPENSPEC_TELEMETRY=0`. This is the command `pnpm spec:check` runs. It passes only when the exit code is `0` and the output reports no errors and no warnings.
4. **On pass:** answer the loop the change loop is blocked on with the decision `amendment-applied`, using the same recipient a text answer would use:
   - a task loop's escalation goes through `answerEscalation`;
   - the group judge's escalation goes through `answerGroupEscalation`.

   Then wait for the new run and print it, the same way `build <change> "<answer>"` does. The exit code follows the build output rules: `0` when built, `1` otherwise.
5. **On fail:** put back the saved bytes, or delete the file if it did not exist before. Print the validation output, `restored <path>` and `nothing resumed`. Exit `2`.

```
$ pnpm change build add-plan-export --amend
amended openspec/changes/add-plan-export/specs/plan/export/spec.md
## openspec validate --all --strict: failed
✗ change/add-plan-export
  [ERROR] requirement "Export writes JSON" is 534 characters (max 500)
restored openspec/changes/add-plan-export/specs/plan/export/spec.md
nothing resumed
exit 2
```

### 3. Answering with text

`pnpm change build add-plan-export "Keep JSON, drop the sort"` works as it does today. It does not write the amendment and does not validate anything.

### Usage line

The `build` line in the usage output becomes:

```
agentscript-change build <change> [<answer>|--amend] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]
```

## Decisions

- **Reuse `Amendment { delta, text }` and `amendment-applied`.** These are the shapes the loops specs and add-spec-amendments-judge already define, and both answer functions already accept the reserved decision. The CLI does not translate either one.
- **Answer the loop the change loop is blocked on.** The amendment can come from a task loop or from the group judge. `--amend` sends `amendment-applied` to that same loop, through `answerEscalation` or `answerGroupEscalation`. A text answer reaches the same loop.
- **Resolve `delta` under the change, and allow only `specs/**/spec.md`.** The write path is always `openspec/changes/<change>/<delta>`. A `delta` that is absolute, contains `..`, or is not a `spec.md` under `specs/` is refused. This keeps to the proposal's scope: no proposal, design or tasks, and nothing in `openspec/specs/`.
- **Validate with `--all --strict`, not `<change> --strict`.** The approved proposal requires this, and gap #17 shows the single-change form misses problems that `--all` catches. Because this is the same command as `pnpm spec:check`, a delta that passes here also passes verify.
- **Any warning fails the check.** The proposal says no errors and no warnings, so a warning in the output fails the check even when the exit code is `0`.
- **Restore from bytes saved in memory, not from git.** The delta may have uncommitted edits that git does not hold. Saving the exact bytes before writing makes the restore exact. If the amendment created a file, the restore deletes it.
- **A failed `--amend` exits `2`.** Like the other refusals of `build`, it starts nothing and leaves the tree as it was. The loop stays `blocked`, so the principal can still answer with text.
- **Diff against the file on disk when the command runs.** What the principal sees is exactly what `--amend` will write over.
- **Only the principal can apply.** `--amend` is a CLI flag a person runs. No loop or agent path calls it.

## Risks

- **`--all` can fail because of another change.** A broken delta in some other change blocks the amendment, even when the amendment is fine. `pnpm spec:check` would fail on it anyway, and the printed validation output names the item that failed.
- **A crash between write and restore.** If the process is killed during validation, the amended file stays on disk and the loop stays `blocked`. Nothing resumes, so the rule that nothing unchecked resumes still holds. Running `pnpm change build <change>` again shows the diff against the file as it is now.
- **Concurrent edits.** If someone edits the delta by hand while `--amend` runs, a restore puts back the bytes saved before the write, and that hand edit is lost. The window is one validation run.
