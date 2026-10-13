## Context

`agentscript-task` (`src/bin/agentscript-task.ts`) dispatches `run`, `resume`, `answer` and `status`. Each opens the harness from `--db` or the config, installs the extensions, and prints text or JSON. `answer` already tells task loops from group loops by the stored task's type. A spec loop is a third type, `agentscript.spec-loop`.

The whole user journey is in [`../add-spec-loop/design/walkthrough.html`](../add-spec-loop/design/walkthrough.html). This change implements its commands.

## A session

```console
$ pnpm task spec add-plan-export --intent "Export a plan as JSON so CI can read it"
# spec loop 12 — blocked (review)
## proposal draft 1: 1 issue
   WARNING proposal.md: touches 3 capabilities, over the budget of 2. Split it into one change per capability: …
## proposal draft 2: clean

Review openspec/changes/add-plan-export/proposal.md, then:
  approve:  pnpm task answer 12 --by principal --decision approve
  revise:   pnpm task answer 12 --by principal --decision "<what to change>"

$ pnpm task answer 12 --by principal --decision approve
# spec loop 13 — converged (approved)
proposal approved by jesse.
Next: pnpm task spec add-plan-export
```

When the design stage exists, "Next" names it. Once every stage in `SPEC_STAGES` is approved:

```
Every stage of add-plan-export is approved. Execute it: pnpm task add-plan-export --next-group
```

## Choosing the stage

```ts
const next = SPEC_STAGES.find((stage) => !currentApproval(approvals, stage, changeDir));
```

A stage is "current" when it has an entry whose hashes match. A named stage skips this, but `startSpecLoop` still refuses it if a stage in its `after` isn't approved.

## intent.md

`intent.md` holds the principal's words, verbatim, with nothing added. On a new change, `--intent` or `--intent-file` is required, and the command refuses `the change add-plan-export does not exist; give --intent or --intent-file`. If the change exists, `intent.md` is read, and passing `--intent` is refused (`intent.md exists; edit it instead`), so the record of what was asked never silently changes.

## Decisions

- **One CLI.** `spec` is a fifth command of `agentscript-task`, not a new bin: `status`, `answer` and the database are shared, and so is `pnpm task`.
- **A review exits 0.** Waiting for the principal is the expected end of a stage, not a failure. A question exits 1, because the agent couldn't proceed.
- **`--principal` defaults from git.** The approval records a name; `git config user.name` is the one already on the principal's commits.

## Risks

- `answer`'s usage line grows a flag. Scripts that parse usage will see it change.
