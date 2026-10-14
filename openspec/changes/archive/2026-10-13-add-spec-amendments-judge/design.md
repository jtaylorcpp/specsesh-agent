# Design: add-spec-amendments-judge

## Context

gaps.md #8. When the group check fails because a spec delta is wrong, the group judge can answer `amend-spec`. Today that answer only carries a `question`. The group loop then ends `blocked` with a level-`"group"` escalation and a `spec-defect` finding, but nothing says which delta to change or what it should say.

The archived add-spec-amendments fixed this for the task loop (see `openspec/specs/task/agent` and `openspec/loops`). It added:

- the `Amendment` type `{ delta, text }`. `delta` is the spec delta's path relative to the change directory (`specs/<capability>/spec.md`). `text` is the full replacement text for that file.
- `Escalation.amendment`, an optional field that holds that `Amendment`.
- the reserved decision `amendment-applied`. An `EscalationAnswer` with this decision tells the loop that the principal has written the amendment to disk.
- the judge read-back variables `amend_path` and `amend_text`. `amend_path` is constrained with `choices`: `''` first, then one entry per delta in `deltas` order.
- the drop rule: if `amend_path` is empty or `amend_text` is blank, the amendment is dropped with the note `amendment dropped: <variable> is empty`, and the loop still escalates.

This change wires the same pieces into `task/group`. It adds no new type and does not change the task loop or the `Amendment` type. It adds no CLI either: reviewing and applying amendments is part of add-spec-amendments-cli. The group loop never writes the amendment itself.

## How it is used

### The judge sets two more variables

The group judge already reads back `next_action`, `rework_task`, `feedback` and `question`. With this change it also reads two more strings, named as in the task loop:

| variable | type | choices | read when |
|---|---|---|---|
| `amend_path` | string | `''`, then each delta of the change in `deltas` order, e.g. `specs/task/queue/spec.md` | `next_action` is `amend-spec` |
| `amend_text` | string | none | `next_action` is `amend-spec` |

Every judge run the group loop starts carries both constraints:

```ts
choices: {
  next_action: ["rework", "ask", "amend-spec"],
  amend_path: ["", "specs/task/queue/spec.md", "specs/task/group/spec.md"], // this change's deltas, in deltas order
}
```

At start, the judge contract check also requires `amend_path` and `amend_text` to be declared as `string`. It checks them the same way the task loop checks its judge. A script missing either one is refused, and the error names the variable. The bundled `group.agent` declares both and fills them from its structured result. Its judge step gains one instruction: "when the spec delta itself is wrong, set `amend-spec`, the delta in `amend_path`, and the delta's whole corrected text in `amend_text`."

### The escalation carries the amendment unchanged

On `amend-spec` with a non-empty `amend_path` and a non-blank `amend_text`, the group ends `blocked`. The escalation is the one the loop builds today, plus an `amendment` field. Example (fake data):

```json
{
  "status": "blocked",
  "escalation": {
    "level": "group",
    "to": "principal",
    "question": "Scenario 'Empty queue' contradicts the ticked-task rule; replace the delta?",
    "amendment": {
      "delta": "specs/task/queue/spec.md",
      "text": "## MODIFIED Requirements\n\n### Requirement: …full file…"
    }
  }
}
```

The round is recorded as an iteration with a `spec-defect` finding and `amend-spec` feedback, as it is now.

If `amend_path` is `''` or `amend_text` is blank, the loop drops the amendment and records the note `amendment dropped: amend_path is empty` (or `amendment dropped: amend_text is empty`), as the task loop does. The group still ends `blocked` with the same level-`"group"` `spec-defect` escalation, just without `amendment`. A bad amendment never fails the group.

### The principal applies it, then answers `amendment-applied`

The full host flow is in `design/examples/amend-group.ts`, and a rendered session is in `design/mock.html`. The core of it:

```ts
const outcome = await waitForGroupLoop(harness, id, ctx);
if (outcome.status === "blocked" && outcome.escalation.amendment) {
  const { delta, text } = outcome.escalation.amendment;
  // the principal reviews and writes `text` to openspec/changes/<change>/<delta>
  // (by hand here; add-spec-amendments-cli will do this step)
  await answerGroupEscalation(harness, id,
    { by: "principal", decision: "amendment-applied" }, ctx);
}
```

An `amendment-applied` answer resumes the group as a new run, the same as any other answer to a judge block:

1. The loop reads the change's deltas from disk again, so `deltas` and the `amend_path` choices reflect the amended text.
2. It reruns the group check.
3. If the check passes, the group ends `converged`. If it fails, the judge runs with the new `deltas`, and the decision is appended to `check_output` as for any judge-block answer.

This does not use up any of the `reworks` budget.

## Decisions

- **Reuse, don't define.** `Amendment { delta, text }`, `Escalation.amendment`, `amendment-applied`, the variables `amend_path`/`amend_text`, the `amend_path` choices and the drop rule all work as add-spec-amendments defined them for the task loop. The `Amendment` built from the judge's variables goes into the escalation unchanged, with no trimming or rewriting, so the principal sees exactly what the judge proposed.
- **`amend_path` is constrained, not validated afterwards.** The choices list `''` and then the change's deltas, so the judge cannot name a proposal, design, tasks or any other file. Only spec deltas can be amended.
- **A bad amendment is dropped, not fatal.** An empty `amend_path` or blank `amend_text` drops the amendment with the note `amendment dropped: <variable> is empty`. The group still ends `blocked` on the `spec-defect` escalation, so the principal still gets the judge's question.
- **The loop does not apply or verify the amendment.** `amendment-applied` is the principal saying it was applied. The loop only re-reads the deltas, and the rerun group check is the real test. Applying the amendment is part of add-spec-amendments-cli.
- **`amendment-applied` resumes like a judge block.** It reruns the check and then the judge. It does not reopen tasks or use the rework budget. If a task-level block (one with no amendment) is answered with `amendment-applied`, the existing task-block path applies: the task loop handles that decision itself.
- **`ask` and `rework` are unchanged.** `amend_path` and `amend_text` are ignored unless `next_action` is `amend-spec`.

## Risks

- **Custom group scripts are refused after upgrade.** Scripts written before this change don't declare `amend_path` and `amend_text`, so the start check refuses them, naming the missing variable. The bundled `group.agent` is updated in this change.
- **Unapplied amendment.** A principal can answer `amendment-applied` without writing the file. The check will most likely fail again, and the judge sees the unchanged delta. That wastes one round but gives no wrong result.
- **Large replacement text.** The full delta text is stored in the checkpoint and in the outcome. That is acceptable at spec-delta sizes, and the task loop made the same trade-off.
- **Durable version.** The checkpoint shape does not change. Only the judge's read-back and the resume path do, so `agentscript.group-loop` stays at version `1`. Loops that are already blocked can still be answered: `amendment-applied` on a block with no amendment is treated as a plain judge answer.
