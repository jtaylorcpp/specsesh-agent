## Context

`scripts/spec-archive.mjs` is how this repository archives today. It exists because `openspec archive --yes` (1.14.1) can archive with exit `0` while dropping requirements, and because a change can validate while the specs it folds into don't. So it runs three steps: validate the change, fold it into a copy of `openspec/` and validate that, and only then archive for real. `close` moves those steps into the package and puts a guard in front of them.

The flow is in [`../add-change-draft/design/mock.html`](../add-change-draft/design/mock.html), step 8. The commands are in [`design/examples/close.sh`](design/examples/close.sh).

## close

```
close <change>
  guard   every task in tasks.md ticked                       else exit 2, listing the unticked
          newest change loop of the change, if any, converged  else exit 2, naming its state
          openspec validate <change> --strict                  else exit 2, first issue
  trial   cp -r openspec/ $tmp/openspec
          (cd $tmp) openspec archive <change> --yes && openspec validate --specs --strict
          else exit 2, openspec/ untouched
  fold    openspec archive <change> --yes
  print   capabilities folded into, archive directory, the commit command
```

The ontology's `archiveGuard` asks for a converged change loop. A change built task by task with `pnpm task` has no change loop, so `close` asks for the evidence every route leaves: every task ticked. When a change loop exists, it must have converged. A build waiting for an answer can't be closed.

## A session

```console
$ pnpm change close add-plan-export
# add-plan-export — closed
Folded into plan/export (new) and plan/cli (2 modified).
Moved to openspec/changes/archive/2026-10-14-add-plan-export/

Commit it: git add -A openspec && git commit
```

## Decisions

- **No commit.** Every command in this package leaves committing to the principal. `close` prints the command.
- **No `--force`.** An unfinished change is finished by `build`, or by ticking a task you did by hand.

## Risks

- **Task lists that end with an archive task.** Plans written before this still carry `pnpm spec:archive <change>` as their last task. `parked.md` records that the plan stage should stop writing it, now that `close` exists.
