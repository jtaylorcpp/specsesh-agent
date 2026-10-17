# system.instructions is the standing text every model step gets as its system prompt.

`system:` holds one field, `instructions`. Write it as a multiline block with `|`.

```agent
system:
    instructions: |
        You help the author write specs.
        Be brief. Never invent requirements.

subagent draft:
    description: "Draft the spec"

    reasoning:
        instructions: ->
            | Draft a one-paragraph spec.
```

At run time:

- The text goes to the model in its own channel, the system prompt, on every step that makes a
  request. It is never mixed into a step's prompt.
- It is fixed text. It is not composed against run state, so `{!@variables.x}` written here goes
  to the model as written, not filled in. Anything that depends on state belongs in a step's
  [prompt lines](prompts.md).
- A subagent that makes no model request (only logic lines, or a `run`) never sends it.

There is one `system` block per document. A subagent cannot have its own `system:`. It is refused.
