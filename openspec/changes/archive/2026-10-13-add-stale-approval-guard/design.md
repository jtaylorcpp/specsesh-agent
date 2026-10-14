# Design: add-stale-approval-guard

## Context

`pnpm change build <change>` trusts `approvals.json`. `draft` and `approve` already compare each approved stage's files with the sha256 recorded when the stage was approved, and treat a mismatch as stale. `build` does not. That is how hand edits to approved spec deltas in add-delete-file-grant (3.2) and add-spec-amendments-cli (4.2) went in without review (gaps.md #16).

This change adds that same check to `build`, at the two points where `build` starts or continues work:

1. `build <change>` when no change loop is waiting for an answer (a new build starts).
2. `build <change> "<answer>"` and `build <change> --amend` when a change loop is `blocked` (the build continues).

The commands that start nothing stay as they are: `build <change>` on a blocked loop still just prints the question, and on a built change it still says it is built. `close`, `draft` and `approve` don't change.

`--amend` already writes a spec delta, validates it and resumes the loop. After this change, it also updates the specs approval when validation passes. Otherwise the next `build` would refuse the file `--amend` just wrote.

## How it is used

The full session is in `design/examples/stale-approval-session.sh`, and `design/mock.html` shows it as rendered terminal output.

### A hand edit is refused

Someone edits an approved delta by hand, then runs `build`:

```sh
$ $EDITOR openspec/changes/add-plan-export/specs/plan/export/spec.md
$ pnpm change build add-plan-export
add-plan-export: approved files changed since they were approved; build refused
  specs: specs/plan/export/spec.md (changed)
review it with: pnpm change draft add-plan-export
then approve it again: pnpm change approve add-plan-export
$ echo $?
2
```

- The message goes to stderr, the command exits `2`, and no loop starts or is answered.
- There is one line per file: `  <stage>: <path relative to the change> (changed|missing)`. Lines are grouped in stage order (proposal, design, specs, tasks) and sorted by path within a stage. A recorded file that has been deleted shows as `missing`.
- `draft` already redrafts from the earliest stale stage, so the refusal names that one command and does not need to say which stage it starts from.

The refusal is the same when a waiting build is answered:

```sh
$ pnpm change build add-plan-export "Use the v2 API"
add-plan-export: approved files changed since they were approved; build refused
  design: design.md (changed)
  specs: specs/plan/export/spec.md (changed)
review it with: pnpm change draft add-plan-export
then approve it again: pnpm change approve add-plan-export
```

The blocked loop stays `blocked`, so the same answer can be given again once the stages are approved.

### Recovering through review

```sh
$ pnpm change draft add-plan-export      # redrafts from the specs stage
$ pnpm change approve add-plan-export    # records new sha256s
$ pnpm change build add-plan-export      # passes the check, starts or continues
```

### Amending a delta mid-build

When the build is blocked on an escalation carrying an `Amendment`:

```sh
$ pnpm change build add-plan-export --amend
amended openspec/changes/add-plan-export/specs/plan/export/spec.md
## validation: passed
approved specs/plan/export/spec.md as jesse: amendment-applied
resumed task 2.2 with decision: amendment-applied
# add-plan-export — built
...
pnpm change close add-plan-export
```

The step order:

1. The existing `--amend` refusals (an answer was also given, the loop isn't blocked, there's no `Amendment`, the delta is outside `specs/**/spec.md`).
2. The stale-approval check over every approved stage, using the files as they are before the write. If a file was edited by hand, including the delta about to be amended, `--amend` refuses as above and writes nothing.
3. Write `text`, run validation and the trial fold, as `--amend` already does.
4. **New:** if validation passes, set the delta's sha256 in the specs approval to the hash of the bytes just written, with the principal and the note `amendment-applied`, and print `approved <delta> as <principal>: amendment-applied`.
5. Answer the blocked loop with `amendment-applied`, as `--amend` already does.

The principal is resolved the same way `approve` resolves it by default: `git config user.name`, then `$USER`. `build` gets no `--principal` flag, because the proposal adds none.

If validation fails, nothing changes: the delta is restored, nothing is recorded in `approvals.json`, nothing is resumed, and the command exits `2`.

## Decisions

- **One staleness rule.** `build` calls the same per-stage comparison that `draft` uses to pick the stage to redraft from. Then `build` refuses exactly when `draft` would redraft, and the next step in the message always has something to do. A second hash walk could disagree with the first.
- **The check runs only before starting or continuing.** It runs after argument parsing and the `--amend` argument refusals. It runs before the dirty-tree check, so a hand edit gets the specific message instead of `--allow-dirty`. Commands that start nothing (show the question, report built) don't check, because the proposal limits the check to starting or continuing.
- **The check covers every approved stage, not just specs.** An edited proposal, design or tasks file is refused too. Only `--amend` is limited to spec deltas.
- **`--amend` checks before it writes.** If the delta being amended had already been hand-edited, that edit would otherwise be overwritten and then put back on a failed validation, so it would never be reviewed. Refusing first keeps one rule: unreviewed bytes never pass through `build`.
- **The hash is recorded before the loop is resumed.** The resumed run continues the build. Recording first means the file on disk always matches its approval when the loop moves on. If recording fails, nothing is resumed, the command exits `2`, and the delta stays written. A rerun of `--amend` is then refused as stale, and the person goes back to `draft`/`approve`.
- **Only the amended file's entry changes.** The other entries in the specs approval and the other stages' approvals stay byte-for-byte the same, and the format of `approvals.json` doesn't change.

## Risks

- **Fields in `approvals.json`.** The proposal says the format does not change, and it also says the update is recorded "as the principal, with the note `amendment-applied`". This assumes an approval can already hold who approved and a note. If it can't hold a note, the amendment would need either a format change or the note dropped. That decision belongs to the principal, not this design.
- **Edits during a run aren't caught.** The check runs when `build` is invoked. A hand edit made while a build is running is caught at the next `build` that starts or continues, not partway through the run. The proposal limits the check to that point.
- **Existing blocked builds.** Changes whose deltas were already hand-edited (the two in gaps.md #16) will be refused at their next answer. This is intended, but they have to go through `draft`/`approve` before continuing.
- **Overlap with the dirty-tree refusal.** A hand edit that hasn't been committed also makes the tree dirty. Because the stale check runs first, `--allow-dirty` can't be used to get around it.

