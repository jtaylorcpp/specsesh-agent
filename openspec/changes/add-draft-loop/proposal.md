## Why

After the four stage changes, each stage is its own spec loop, started by its own `spec` command. Drafting a whole change means typing `spec`, reviewing, answering, then typing `spec` again for the next stage, four times. The principal wants one command that drafts a change from start to finish, stopping only for review. That needs a loop above the stages, the way the group loop sits above the task loops: it runs each unapproved stage in order as a child spec loop and passes each review up to the principal. This change builds that loop; the command follows in `add-draft-cli`.

## What Changes

- **`agentscript.draft-loop`**, one durable task with phases `next`, `stage` and `answer`:
  - `next` picks the first stage without a current approval, or ends `converged` when every stage has one;
  - `stage` runs that stage as an `agentscript.spec-loop` child and awaits it;
  - a child that blocks, for review or a question, blocks the draft with the child's escalation;
  - a child that is exhausted or fails ends the draft `failed`, naming the stage.
- **`answerDraftLoop`** starts a new draft run at `answer`, which hands the answer to `answerSpecLoop`. An approval converges that stage and the draft moves on to the next one. A revision redrafts the same stage.
- **`DraftOutcome`**: `{ change, stages }`, one entry per stage, each with `approved` and the number of spec loops this draft ran for it.
- **`startDraftLoop`, `waitForDraftLoop`, `answerDraftLoop` and `draftLoopExtensions`** in `./task`.

## Out of scope

- The `draft` command, its output and `status`: `add-draft-cli`.
- JSON Lines events for draft loops.
- Running stages in parallel. Each stage needs the one before it approved.

## Capabilities

- **New:** `spec/draft`.

## Impact

- New: `packages/agent/src/task/draft-input.ts`, `draft-loop.ts`, `draft-api.ts`; tests with the faux provider and stages defined in the tests.
- Depends on `add-spec-plan-stage` (and through it every earlier spec change), archived first: the default stages are `SPEC_STAGES`.
