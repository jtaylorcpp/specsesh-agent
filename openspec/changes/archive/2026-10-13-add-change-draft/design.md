## Context

`agentscript-task` is loop-centred: `run`, `spec`, `resume` and `answer` take or print loop ids. `add-draft-loop` gives `startDraftLoop` and `answerDraftLoop`. `src/task/status.ts` can already list every loop in a database with its change (`listLoops`, `changeOf`).

The principal asked for a flow named for what happens to a change:

```
pnpm change draft    write it, stage by stage, with the agent
pnpm change approve  accept the stage under review
pnpm change build    execute it, group by group, with the agents
pnpm change close    fold it into the specs
```

The whole flow, once the four `add-change-*` changes are in, is clickable in [`design/mock.html`](design/mock.html). The commands are in [`design/examples/session.sh`](design/examples/session.sh). This change builds `draft`.

## A change's state

`changeState` reads the database, never the terminal: it finds the newest draft loop whose change is this one, plus `approvals.json`.

| Newest draft loop | State | `draft` | `draft "<text>"` |
|---|---|---|---|
| `blocked`, reason `review` | waiting for review | shows the review again, exit 0 | revises: `answerDraftLoop(text)` |
| `blocked`, reason `question` | waiting for an answer | shows the question again, exit 1 | answers: `answerDraftLoop(text)` |
| none, or ended otherwise, with a stage unapproved | ready to draft | starts a draft loop | refused, nothing waits |
| any, with every stage approved and unchanged | drafted | says so, exit 0 | refused, nothing waits |

Starting only when nothing is waiting means a change never has two draft loops at once. An exhausted or failed draft is restarted by the next `draft`, with a fresh budget for the stage.

## A session

```console
$ pnpm change draft add-plan-export --intent "Export a plan as JSON so CI can read it"
# add-plan-export — waiting for review of the proposal
### proposal draft 1: 1 issue
   WARNING proposal.md: touches 3 capabilities, over the budget of 2. …
### proposal draft 2: clean

Review openspec/changes/add-plan-export/proposal.md, slices.md, then:
  revise:   pnpm change draft add-plan-export "<what to change>"
  approve:  pnpm task answer 12 --by principal --decision approve

$ pnpm change draft add-plan-export "JSON only; no CSV"
# add-plan-export — waiting for review of the proposal
### proposal draft 3: clean
…
```

`add-change-approve` replaces the last line with `pnpm change approve add-plan-export`.

## Decisions

- **A new bin, not more `agentscript-task` commands.** The two CLIs answer different questions. `pnpm task` is about loops: run this task, resume that loop. `pnpm change` is about changes: where is this one, and what's next. They share the database, the config and the loops.
- **Feedback is a positional argument.** `pnpm change draft <id> "JSON only"` reads as a sentence, and a decision is always free text.
- **The root script runs the built bin**, as `pnpm task` does. Before `pnpm build` it fails saying the file is missing.

## Risks

- **A loop id still appears** in the approve line until `add-change-approve` lands. That change is next in the queue.
