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

Every step that makes a model request gets the same block, including steps that are offered no
tools. So keep it role-neutral: don't write "you edit files in the workspace" there, because a
planning or judging step will read it as its own job. Say each step's role, and whether it has
tools, at the top of that step's prompt instead (`You are the judge step: … You have no tools:
decide only from the text below.`). A script copied from an older bundled `task` template
(`specsesh agent show task`) still opens its system block with "in a real workspace"; update it to
match the current one.

There is one `system` block per document. A subagent cannot have its own `system:`. It is refused.
