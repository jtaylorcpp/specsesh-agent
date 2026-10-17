# A prompt line starts with `|` and is text the model reads; a subagent's surviving lines make one request.

```agent
subagent draft:
    description: "Fill the proposal"

    reasoning:
        instructions: ->
            | Read the change description.
            | Write a short proposal for it.
```

At run time:

- The interpreter walks the procedure top to bottom. Every prompt line it reaches is
  [interpolated](interpolation.md) with the variables' values at that point and kept.
- The kept lines are joined with newlines, in source order, into one prompt, and the subagent
  makes one model request with it. The [system instructions](system.md) go with it as the system
  prompt.
- A prompt line inside an `if` branch that doesn't hold is not kept ([logic](logic.md)).
- If no prompt line survives and the step needs no structured result, the subagent makes no
  request. If it does need one, the run stops with `EmptyPromptError` rather than pay for an
  answer to nothing ([outputs](outputs.md)).
- Without `set … = @outputs.…` lines, the model's reply is free text. It goes into the run's step
  report and sets no variable. Prose is never parsed for a value.

A prompt line cannot sit in a subagent that holds a `run` statement ([run](run.md)).
