## Context

`add-change-draft` gives `pnpm change draft` and `changeState`, which finds a change's newest draft loop and what it waits for. Approving still goes through `pnpm task answer <id> --decision approve`, because `answerSpecLoop` reads the decision `approve` as an approval (`add-spec-review`).

The flow is in [`../add-change-draft/design/mock.html`](../add-change-draft/design/mock.html), steps 3 to 5. The approve-specific commands are in [`design/examples/approve.sh`](design/examples/approve.sh).

## approve

```
approve <change>
  changeState(change)
    waiting for review   → answerDraftLoop(id, { by: "principal", principal, decision: "approve" })
                           → wait → print as draft (the next stage's review, or drafted)
    waiting for answer   → exit 2: "add-plan-export is waiting on a question, not a review:
                                    <question>
                                    answer: pnpm change draft add-plan-export \"<answer>\""
    anything else        → exit 2: "nothing in add-plan-export is under review"
```

`--principal` defaults the way `pnpm task answer` does for a spec loop: `git config user.name`, then `$USER`. If neither gives a name, the command is refused, because an approval must say who approved.

## Why "approve" stops being feedback

The decision `approve` approves, by `add-spec-review`'s rule. Before this change, `pnpm change draft <id> approve` would therefore approve by accident. Now `draft` refuses it and names `approve`. Approving takes a separate verb, so a revision request can never approve a stage.

## Slices

When `approve` approves a proposal whose `slices.md` lists later slices, its output adds:

```
Sliced into 3 changes. Draft the others when you're ready:
  pnpm change draft add-plan-export-schema --intent "Publish the JSON Schema of the export. Follows add-plan-export."
  pnpm change draft add-plan-export-ci --intent "Fail a PR whose plan export is invalid. Follows add-plan-export-schema."
```

## Decisions

- **No "approve all".** Every stage gets its own review, and each `approve` shows the next stage's draft right away.
