## Context

`add-spec-loop` and `add-spec-review` give us one spec loop per stage. It drafts until its gate is clean, then ends `blocked` for review. `answerSpecLoop` starts a new run, which converges with an approval or drafts again. `SPEC_STAGES` lists the four stages in order, each naming the stages it comes `after`.

The group loop (`src/task/group.ts`) already runs children in order and passes their blocks up. The draft loop copies that shape, with stages in place of tasks and no check or judge of its own: each stage's gate and the principal's review already do that job.

The example is [`design/examples/draft.ts`](design/examples/draft.ts).

## The loop

```
start(change, stages = SPEC_STAGES)
  next     first stage with no approval whose hashes match → stage
           none                                            → converged { change, stages }
  stage    start agentscript.spec-loop child for it (once; id in the checkpoint) → await
           converged (approved) → entries += { stage, approved: true, runs } → next
           blocked              → blocked, child's escalation unchanged
           exhausted | failed   → failed, "the design stage ended exhausted"

answerDraftLoop(id, answer)
  only a blocked draft
  new run at answer
  answer   answerSpecLoop(child, answer) → new child id → await → as stage
```

The draft never decides anything. Every block is the stage's own, so the review question, its files and its `to: "principal"` reach the principal exactly as `spec` shows them. Only the principal approves, because `answerSpecLoop` already refuses anyone else.

## The outcome

```ts
type DraftOutcome = {
  change: string;
  stages: { stage: string; approved: boolean; runs: number }[];
};
```

Blocked and failed outcomes carry the result so far, as the group loop's do. A stage that was approved before the draft started is entered with `runs: 0`, so the outcome always says which stages this draft wrote.

## Runs and answers

An answer starts a new draft run rather than resuming the blocked one, as task and group answers do. The new run carries the entries forward, so its outcome covers every stage. Its first phase is `answer`: it calls `answerSpecLoop` once, commits the new child's id, and then behaves like `stage`. A crash after the commit continues the same child, the same way a crash during `stage` does.

## Decisions

- **The stages are an option.** `stages` defaults to `SPEC_STAGES`. Tests pass two small stages defined in the test, so this change needs no real gate and no `openspec` binary.
- **No budget of its own.** Each spec loop has `maxIterations`. A draft that never converges is a principal who keeps asking for revisions, and that's their call.
- **Approval stays per stage.** The draft doesn't approve anything itself and has no "approve all".

## Risks

- **A crash between `answerSpecLoop` and the commit** could leave a spec run that no draft awaits. The answer then has to be given again. The window is one call, the same as for `answerEscalation` today.
