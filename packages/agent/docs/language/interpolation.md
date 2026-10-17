# `{!@variables.x}` in a prompt line is replaced by the variable's current value.

```agent
variables:
    stage: mutable string = "proposal"
    change_id: string = "OS-1"
    attempts: mutable number = 2

subagent draft:
    description: "Fill the current stage"

    reasoning:
        instructions: ->
            | Draft the {!@variables.stage} for change {!@variables.change_id}.
            | This is attempt {!@variables.attempts}.
```

At run time:

- The value is the variable's at the point the walk reaches the line, so a `set` on an earlier
  line is visible ([logic](logic.md)).
- Values are written as plain text: a string as is, a number in its shortest form (`2`), a boolean
  as `true` or `false`.
- The variable must be declared. An undeclared name is an error before the run starts.
- Only `@variables` can be interpolated. `{!@context.user}` and every other namespace are refused.

The `!` is part of the syntax. `{@variables.stage}` without it is not interpolation: the dialect
flags it, and the braces and text reach the model as written. Read your diagnostics.

Interpolation works only in prompt lines. In `system.instructions`, `{!@variables.x}` reaches the
model unfilled ([system](system.md)).
