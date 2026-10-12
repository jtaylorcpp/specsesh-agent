## Context

`agentscript-task` has `run`, `spec`, `resume`, `answer` and `status` (after `add-spec-cli`). `spec` runs one stage and prints its drafts, and after a review it prints the approve and revise commands. `answer` already chooses between task, group and spec loops by the stored task's type.

`add-draft-loop` gives `startDraftLoop` and `answerDraftLoop`. A draft loop runs every unapproved stage as a child spec loop and ends `blocked` at each review.

The session is clickable in [`design/mock.html`](design/mock.html). The commands alone are in [`design/examples/session.sh`](design/examples/session.sh).

## A session

```console
$ pnpm task draft add-plan-export --intent "Export a plan as JSON so CI can read it"
# draft 12 — blocked (review)
### proposal draft 1: 1 issue
   WARNING proposal.md: touches 3 capabilities, over the budget of 2. …
### proposal draft 2: clean

Review openspec/changes/add-plan-export/proposal.md, slices.md, then:
  approve:  pnpm task answer 12 --by principal --decision approve
  revise:   pnpm task answer 12 --by principal --decision "<what to change>"

$ pnpm task answer 12 --by principal --decision approve
# draft 13 — blocked (review)
## proposal: approved
### design draft 1: clean

Sliced into 3 changes. Draft the others when you're ready:
  pnpm task draft add-plan-export-schema --intent "Publish the JSON Schema of the export. Follows add-plan-export."
  pnpm task draft add-plan-export-ci --intent "Fail a PR whose plan export is invalid. Follows add-plan-export-schema."

Review openspec/changes/add-plan-export/design.md, design/mock.html, design/examples/export.sh, then:
  approve:  pnpm task answer 13 --by principal --decision approve
  revise:   pnpm task answer 13 --by principal --decision "<what to change>"

  … two more reviews …

$ pnpm task answer 15 --by principal --decision approve
# draft 16 — converged
## proposal: approved
## design: approved
## specs: approved
## tasks: approved

Every stage of add-plan-export is approved. Execute it: pnpm task add-plan-export --next-group
```

`spec` prints its drafts under `##`. In `draft`, a stage's drafts move down to `###`, because `##` lists the stages.

## One loop at a time per change

Before starting, `draft` lists the loops in the database and looks for a spec or draft loop of the same change that ended `blocked` and has no answering run. If it finds one:

```
add-plan-export is waiting for an answer to loop 12 (review of the design).
  approve:  pnpm task answer 12 --by principal --decision approve
  revise:   pnpm task answer 12 --by principal --decision "<what to change>"
```

That's exit `2`, and nothing starts. Without it, a second `draft` would start a second spec loop for the stage under review.

## Decisions

- **Keep `spec`.** `spec <change> <stage>` reruns one stage, for example the design after a hand edit, without starting a draft. `draft` is what the guide teaches first.
- **The answer prints the new run.** The principal reads one block of output per review and copies the next command from its last lines, as with `spec`.
- **The slice commands use `draft`.** Each slice is a whole change and gets drafted end to end.

## Risks

- `status` grows a fourth kind of loop. Its line format stays the same, with `draft <stage>` where a task loop shows its task.
