# Design: add-spec-amendments

## Context

This change covers slice 1 of `slices.md`. When the task loop's judge answers `next_action` `"amend-spec"`, today it can return only an `unmet` reason and a `question`. The agent has often already worked out the fix, but the reply has no field for it. In the 21-change run, a person had to write the fix again by hand four times (gaps.md #8).

This slice makes three changes:

1. **`openspec/loops`**
   - Adds an `Amendment` type.
   - Adds an optional `Escalation.amendment`.
   - Adds a reserved `EscalationAnswer.decision` value, `"amendment-applied"`.
2. **`task/agent`**
   - The task-script contract gains two read-back variables, `amend_path` and `amend_text`.
   - The loop checks both values and puts them in the `"blocked"` outcome's escalation.
   - `answerEscalation` accepts the new decision.
3. **Bundled scripts.** `task.agent` and `task-delegate.agent` fill in the two new variables.

This slice does not change `task/group` (slice 2) or `change/cli` (slice 3). It does not show a diff, write a file, run `openspec validate` or add `--amend`. A text answer still works as it does today.

## How it is used

### 1. The script's reply contract

A task script now declares two more read-back variables, both strings with default `""`. The full excerpt is in `design/examples/task-contract.agent`.

```
variables:
    met: mutable boolean = False
    unmet: mutable string = ""
    next_action: mutable string = "retry"
    question: mutable string = ""
    amend_path: mutable string = ""     # new: the delta to change, e.g. "specs/task/agent/spec.md"
    amend_text: mutable string = ""     # new: the whole replacement text of that file
```

The judge prompt in both bundled scripts gains one paragraph:

> When next_action is amend-spec, set amend_path to the delta that is wrong, exactly as listed, and set amend_text to the whole new text of that file, not a patch. For any other next_action, leave both empty.

The loop limits `amend_path` with `choices`, in the same way it already limits `next_action`. The judge step's `submit_result` schema then lists exactly the allowed paths:

```json
{
  "next_action": { "type": "string", "enum": ["retry", "amend-spec", "ask"] },
  "amend_path":  { "type": "string", "enum": ["", "specs/openspec/loops/spec.md", "specs/task/agent/spec.md"] },
  "amend_text":  { "type": "string" }
}
```

### 2. The blocked outcome carries the amendment

```ts
// openspec/loops — new and changed types
type Amendment = {
  delta: string;  // relative to openspec/changes/<change>/, always "specs/<capability>/spec.md"
  text: string;   // full replacement text of that file
};

type Escalation = {
  level: "task" | "group" | "change";
  to: "principal" | "agent";
  reason: string;
  question: string;
  amendment?: Amendment;            // new: only on an escalation raised by "amend-spec" feedback
};

type EscalationAnswer = {
  escalation: Escalation;
  by: "principal" | "agent";
  decision: string | "amendment-applied";   // new reserved value
  feedback: Feedback[];
};
```

When the loop blocks on an `amend-spec` reply, its outcome looks like this:

```json
{
  "status": "blocked",
  "iterations": [ "…2 iterations…" ],
  "escalation": {
    "level": "task",
    "to": "principal",
    "reason": "The delta says run throws UndeclaredVariableError; the lint refuses the script first.",
    "question": "The spec says run throws UndeclaredVariableError; the lint refuses first. Amend?",
    "amendment": {
      "delta": "specs/durable/host/spec.md",
      "text": "## MODIFIED Requirements\n\n### Requirement: An undeclared variable is refused by the lint\n…"
    }
  }
}
```

### 3. Answering

There are two ways to answer. The full host code is in `design/examples/answer-amendment.ts`.

```ts
// a) Text answer: unchanged from today. Nothing is written.
await answerEscalation(harness, id, {
  escalation, by: "principal",
  decision: "Keep the spec; make run check variables before the lint.",
  feedback: [],
}, context);

// b) The principal has applied the amendment. In this slice that means editing the
//    delta by hand or with escalation.amendment.text. Slice 3's `--amend` will
//    send this answer itself.
await answerEscalation(harness, id, {
  escalation, by: "principal",
  decision: "amendment-applied",
  feedback: [],
}, context);
```

For answer (b), the first iteration of the resumed run gets this `carried` text:

```
The principal applied your amendment to specs/durable/host/spec.md. That delta now reads:

<amendment.text>
```

`design/mock.html` shows the whole session as a rendered flow:

- the block;
- the outcome;
- both kinds of answer;
- the dropped-amendment case;
- the rejected answers.

## Decisions

1. **The amendment is optional on `Escalation`.**
   - It is present only on an escalation raised by `amend-spec` feedback that carried a usable amendment.
   - An `ask` escalation never has one.
   - Existing escalations and stored outcomes stay valid without migration.
2. **`delta` is relative to the change directory and always has the form `specs/<capability>/spec.md`.**
   - This matches the principal's "under `openspec/changes/<change>/specs/`".
   - It is also defined for changes given as texts: the loop knows each delta's capability path from the `## <capability path>` prefixes.
3. **`amend_path` is limited by `choices`.**
   - The allowed values are `""` plus one path per delta of the change, sorted the same way as `deltas`.
   - The model cannot name a file outside the change's deltas.
   - Creating a new delta file is not allowed, because the proposal says the amendment changes an existing delta.
   - The contract check refuses a script whose `amend_path` default is not `""`, in the same way it refuses a bad `next_action` default.
4. **`amend_path` and `amend_text` are required contract variables.**
   - The proposal says the reply contract changes, so a script missing either one is refused at start. The refusal names the variable and `string`.
   - Making them optional would mean an agent's fix can be lost without any error.
5. **A bad amendment is dropped, and the escalation still happens.**
   - This applies when `amend-spec` comes with an empty `amend_path` or an empty or whitespace-only `amend_text`.
   - The loop still ends `"blocked"` with the `"spec-defect"` finding, exactly as today, but the escalation has no `amendment`.
   - The loop adds a note: `amendment dropped: <why>`.
   - The spec defect is real, so it still has to reach the principal. A text answer works whatever the payload is.
   - For `retry` and `ask`, the loop ignores both fields.
6. **`"amendment-applied"` is a reserved `decision` string, not a new field.**
   - "The loop vocabulary gains a decision", so the existing `decision` field carries it.
   - It is valid only when `escalation.amendment` is present and `by` is `"principal"`. Otherwise `answerEscalation` rejects it as invalid input and the loop stays blocked.
   - Rejecting `by: "agent"` puts the out-of-scope rule "an agent answering an amendment" into code.
   - Applying requires `by: "principal"`. If the escalation went to `"agent"` (because `escalateTo` was set to it), only a text answer is possible.
7. **The resumed run sees the amendment through `carried`, not by re-reading files.**
   - Sources are read once into the durable input, and that rule stays.
   - The fixed `carried` text quotes `amendment.text`, which is already in the durable outcome. Resuming is still deterministic and reads no file.
8. **Only the loop decides that the amendment was applied.**
   - This slice does not check that the file on disk matches `amendment.text`. Writing and validating the file is slice 3's job.
   - The answer is recorded as the principal's word.

## Risks

- **The resumed run's `deltas` variable still holds the old text.** The new text reaches the agent only as `carried`, so for the rest of that run its seeded `deltas` contradicts what the agent was told. The `carried` wording says plainly which file's text replaces which. Reseeding `deltas` would change the read-once rule, so it is left out of this slice.
- **`"amendment-applied"` can be sent without anything being written.** In this slice the loop takes the principal's word for it. Slice 3's `--amend` closes this gap by writing and validating the file before it answers.
- **Long replacement texts.** A whole delta in one result field makes the judge step's output bigger and makes truncation more likely. A truncated `amend_text` would still be carried. The principal sees it in full before applying, and slice 3 runs strict validation.
- **Custom scripts break.** Any script outside this repository that lacks `amend_path` or `amend_text` is refused at start. The refusal names the missing variable, so the fix is two lines.
- **Stale amendments.** Between the block and the answer, someone may edit the delta by hand. This slice keeps no base text to compare against. Slice 3 shows the diff against the file on disk.
- **Group and change escalations.** Until slice 2, an `amend-spec` from the group judge has no amendment. Code that reads `escalation.amendment` must treat it as optional.

## Files

- `design/mock.html`: the rendered host session (block, outcome, answers, rejections).
- `design/examples/task-contract.agent`: the variable block a task script declares, plus the judge instruction.
- `design/examples/answer-amendment.ts`: host code that waits, reads the amendment and answers either way.
- `design/examples/blocked-outcome.json`: a full blocked `LoopOutcome<TaskOutcome>` with an amendment.
