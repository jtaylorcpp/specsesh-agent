## Context

`src/task/events.ts` builds task and group events from loop progress, and the CLI writes each one as a JSON line on stderr. A spec loop's progress is its drafts, each a gate round. The events mirror that.

## A stream

```jsonl
{"event":"stage-started","loop":12,"change":"add-plan-export","stage":"proposal","script":"spec-proposal","at":"2026-10-12T17:00:02.114Z"}
{"event":"stage-draft","loop":12,"draft":1,"written":["proposal.md"],"issues":[{"level":"WARNING","path":"proposal.md","message":"touches 3 capabilities, over the budget of 2. …"}]}
{"event":"stage-draft","loop":12,"draft":2,"written":["proposal.md"],"issues":[]}
{"event":"stage-review","loop":12,"files":["proposal.md"],"question":"Review proposal.md for the proposal stage of add-plan-export. Answer approve, or say what to change."}
{"event":"stage-ended","loop":12,"status":"blocked","drafts":2,"approved":false}
```

An approval run streams `stage-started`, then `stage-ended` with `status` `"converged"`, `drafts` `0` and `approved` `true`.

## The live run

The existing live test copies the repo, commits it, and runs one task. A second test, in the same file and with the same skip rule (no `claude` login means skip), runs:

```bash
agentscript-task spec fixture-live-spec --intent "Add a --quiet flag to agentscript-task status that prints only loop ids"
```

It asserts:
- exit `0`;
- a `stage-review` event;
- `proposal.md` exists, and `proposalStage.gate` on it returns no `ERROR` or `WARNING`.

It doesn't judge the proposal's quality; the principal does that at review.

## Decisions

- **`stage-question` is its own kind**, not `stage-review` with a flag: a watcher acts differently on each (one needs a read and a decision, the other a reply).

## Risks

- The live run costs one to a few Opus calls on the subscription, like the existing one. It's opt-in, as before.
